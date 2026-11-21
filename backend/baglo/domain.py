"""Deterministic paper ledger. Money is integer TWD cents; shares are integers."""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json

UNIVERSE = {'2330': '台積電', '2317': '鴻海', '2454': '聯發科',
            '2308': '台達電', '2881': '富邦金', '2882': '國泰金'}
INITIAL_CASH = 30_000_000
MAX_ORDERS = 150  # bounded single-item ledger MVP; never silently discard history

class DomainError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status

def now():
    return datetime.now(timezone.utc).isoformat()

def new_account(mode):
    return {'version': 0, 'mode': mode, 'initial_cash': INITIAL_CASH,
            'cash': INITIAL_CASH, 'positions': {}, 'orders': [], 'auto_enabled': False}

def fingerprint(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def integer(value, field, minimum=1, maximum=100_000):
    if type(value) is not int or not minimum <= value <= maximum:
        raise DomainError(f'{field} 必須是 {minimum}～{maximum} 的整數')
    return value

def place_order(state, body, key):
    if not isinstance(key, str) or not 8 <= len(key) <= 100:
        raise DomainError('缺少有效的 Idempotency-Key')
    allowed = {'symbol', 'side', 'quantity', 'limit_price'}
    if set(body) != allowed:
        raise DomainError('委託欄位需為 symbol、side、quantity、limit_price')
    digest = fingerprint(body)
    for old in state['orders']:
        if old['id'] == key:
            if old['fingerprint'] != digest:
                raise DomainError('相同請求編號不能用於不同委託', 409)
            return state, old
    if len(state['orders']) >= MAX_ORDERS:
        raise DomainError('本版帳戶已達 150 筆紀錄上限，請匯出並升級儲存格式', 409)
    symbol, side = body['symbol'], body['side']
    if symbol not in UNIVERSE or side not in ('buy', 'sell'):
        raise DomainError('不支援的股票或交易方向')
    quantity = integer(body['quantity'], '股數')
    price = integer(body['limit_price'], '限價（分）', maximum=10_000_000)
    value = quantity * price
    fee = max(2000, int((Decimal(value) * Decimal('0.001425')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)))
    pending = [o for o in state['orders'] if o['status'] == 'pending']
    if side == 'buy':
        reserved = sum(o['reserved'] for o in pending if o['side'] == 'buy')
        if value + fee > state['cash'] - reserved:
            raise DomainError('可用模擬資金不足')
        if value > INITIAL_CASH // 5:
            raise DomainError('單筆委託最多為初始本金的 20%')
    else:
        reserved = sum(o['quantity'] for o in pending if o['side'] == 'sell' and o['symbol'] == symbol)
        if quantity > state['positions'].get(symbol, 0) - reserved:
            raise DomainError('可賣股數不足；本版不支援放空')
    order = {'id': key, 'fingerprint': digest, 'symbol': symbol, 'side': side,
             'quantity': quantity, 'limit_price': price, 'reserved': value + fee if side == 'buy' else 0,
             'status': 'pending', 'created_at': now(), 'source': 'manual'}
    result = deepcopy(state)
    result['orders'].append(order)
    return result, order

def cancel_order(state, order_id):
    result = deepcopy(state)
    for order in result['orders']:
        if order['id'] == order_id:
            if order['status'] == 'cancelled':
                return state, order
            if order['status'] != 'pending':
                raise DomainError('此委託不可取消', 409)
            order['status'] = 'cancelled'
            order['cancelled_at'] = now()
            return result, order
    raise DomainError('找不到委託', 404)

def demo_match(state, order_id):
    """An explicitly marked local sandbox fill, NEVER executable in deployed mode."""
    if state['mode'] != 'demo':
        raise DomainError('真實行情撮合尚未啟用', 409)
    result = deepcopy(state)
    for order in result['orders']:
        if order['id'] != order_id:
            continue
        if order['status'] == 'filled':
            return state, order
        if order['status'] != 'pending':
            raise DomainError('只有待成交委託能進行沙盒成交', 409)
        gross = order['quantity'] * order['limit_price']
        fee = max(2000, int((Decimal(gross) * Decimal('0.001425')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)))
        tax = int((Decimal(gross) * Decimal('0.003')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) if order['side'] == 'sell' else 0
        q = order['quantity']
        if order['side'] == 'buy':
            if gross + fee > result['cash']:
                raise DomainError('資金不足', 409)
            result['cash'] -= gross + fee
            result['positions'][order['symbol']] = result['positions'].get(order['symbol'], 0) + q
        else:
            if result['positions'].get(order['symbol'], 0) < q:
                raise DomainError('持倉不足', 409)
            result['cash'] += gross - fee - tax
            result['positions'][order['symbol']] -= q
        order.update(status='filled', filled_at=now(), fill_price=order['limit_price'],
                     fee=fee, tax=tax, fill_source='sandbox_limit_price', slippage=0)
        return result, order
    raise DomainError('找不到委託', 404)
