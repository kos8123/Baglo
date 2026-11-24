"""Paper order matching against real market prices.

Rules (documented in docs/ARCHITECTURE.md):
- Orders are day orders (ROD). An order placed outside 09:00–13:30 on a weekday,
  or on a weekend, belongs to the next weekday session.
- Same-day orders are checked against Fugle 1-minute candles, starting with the
  minute after the order was placed so a fill never uses prices seen before it.
  A buy fills when a candle's low touches the limit; a sell when its high does.
  The fill price is the candle open when that is already better than the limit
  (the order would have crossed immediately), otherwise the limit price.
- Orders from an earlier session fall back to the official daily bar with the
  same touch rule. Orders still unfilled after their session close expire and
  release the cash they reserved.
- Queue position and partial fills are not simulated: touching the limit fills
  the whole order, which is slightly optimistic.

Fetching happens outside the ledger transaction; apply_matches is pure.
"""
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
import logging
import time as clock
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Taipei')
OPEN, CLOSE = time(9, 0), time(13, 30)
# Fugle's last 1-minute candle and the official close are only final a little after 13:30.
SETTLE_AFTER = time(13, 40)
GIVE_UP_DAYS = 7
# Account reads run inside a 25s Lambda; stop fetching after this and settle the rest next time.
FETCH_BUDGET_SECONDS = 8


def fee_and_tax(gross, side):
    fee = max(2000, int((Decimal(gross) * Decimal('0.001425')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)))
    tax = int((Decimal(gross) * Decimal('0.003')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) if side == 'sell' else 0
    return fee, tax


def next_weekday(day):
    day += timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def session_day(created_at):
    """The trading session an order belongs to (weekday calendar; holidays roll forward later)."""
    placed = datetime.fromisoformat(created_at).astimezone(TZ)
    day = placed.date()
    if day.weekday() >= 5 or placed.time() >= CLOSE:
        return next_weekday(day)
    return day


def touched(order, bar):
    """Fill price in cents if this bar reaches the order's limit, else None."""
    limit = order['limit_price']
    if order['side'] == 'buy' and bar['low'] <= limit:
        return bar['open'] if bar['open'] <= limit else limit
    if order['side'] == 'sell' and bar['high'] >= limit:
        return bar['open'] if bar['open'] >= limit else limit
    return None


def fill(state, order, price, at, source):
    gross = order['quantity'] * price
    fee, tax = fee_and_tax(gross, order['side'])
    symbol, quantity = order['symbol'], order['quantity']
    if order['side'] == 'buy':
        if gross + fee > state['cash']:
            return expire(order, at, '成交時模擬資金不足')
        state['cash'] -= gross + fee
        state['positions'][symbol] = state['positions'].get(symbol, 0) + quantity
    else:
        if state['positions'].get(symbol, 0) < quantity:
            return expire(order, at, '成交時持股不足')
        state['cash'] += gross - fee - tax
        state['positions'][symbol] -= quantity
    order.update(status='filled', filled_at=at, fill_price=price, fee=fee, tax=tax,
                 fill_source=source, slippage=0, reserved=0)


def expire(order, at, reason):
    order.update(status='expired', expired_at=at, expire_reason=reason, reserved=0)


def apply_matches(state, market, current):
    """Settle pending orders. market: {'intraday': {(symbol, type): {'date', 'bars'}|None},
    'daily': {symbol: [bars]|None}}. Returns (new_state, changed)."""
    today = current.astimezone(TZ).date()
    result = deepcopy(state)
    changed = False
    for order in result['orders']:
        if order['status'] != 'pending':
            continue
        day = session_day(order['created_at'])
        if day > today:
            continue
        before = order['status']
        if day < today:
            bars = market['daily'].get(order['symbol'])
            past = [b for b in bars or [] if day.isoformat() <= b['date'] < today.isoformat()]
            if past:
                bar = past[0]
                price = touched(order, bar)
                at = datetime.combine(date.fromisoformat(bar['date']), CLOSE, TZ).isoformat()
                if price is not None:
                    fill(result, order, price, at, 'daily_bar')
                else:
                    expire(order, at, '當日收盤前未達限價（當日有效單）')
                changed |= order['status'] != before
                continue
            if bars is not None and (today - day).days > GIVE_UP_DAYS:
                expire(order, current.isoformat(), '連續多日無法取得行情')
                changed = True
                continue
            if bars is None:
                continue
            # The intended session had no trading (holiday): today is its session.
        if current.astimezone(TZ).time() < OPEN:
            continue
        feed = market['intraday'].get((order['symbol'], order.get('market_type', 'odd_lot')))
        if not feed or feed['date'] != today.isoformat():
            continue
        placed = datetime.fromisoformat(order['created_at']).astimezone(TZ)
        start = placed.replace(second=0, microsecond=0) + timedelta(minutes=1)
        for bar in feed['bars']:
            if bar['at'] < start:
                continue
            price = touched(order, bar)
            if price is not None:
                fill(result, order, price, bar['at'].isoformat(), 'intraday_1m')
                break
        if order['status'] == 'pending' and current.astimezone(TZ).time() >= SETTLE_AFTER:
            expire(order, datetime.combine(today, CLOSE, TZ).isoformat(), '當日收盤前未達限價（當日有效單）')
        changed |= order['status'] != before
    return (result, True) if changed else (state, False)


def gather(state, markets, current, budget=FETCH_BUDGET_SECONDS):
    """Fetch only the data the pending orders need. Failures leave orders pending."""
    today = current.astimezone(TZ).date()
    intraday, daily = {}, {}
    deadline = clock.monotonic() + budget
    for order in state['orders']:
        if order['status'] != 'pending' or session_day(order['created_at']) > today:
            continue
        if clock.monotonic() > deadline:
            break
        symbol, kind = order['symbol'], order.get('market_type', 'odd_lot')
        if session_day(order['created_at']) < today and symbol not in daily:
            try:
                daily[symbol] = markets.history(symbol, months=2)['bars']
            except Exception:
                logging.warning('daily bars unavailable for %s', symbol)
                daily[symbol] = None
        if (symbol, kind) not in intraday and current.astimezone(TZ).time() >= OPEN:
            try:
                intraday[(symbol, kind)] = markets.intraday_candles(symbol, kind)
            except Exception:
                logging.warning('intraday candles unavailable for %s', symbol)
                intraday[(symbol, kind)] = None
    return {'intraday': intraday, 'daily': daily}


def settle(store, markets, account, current=None):
    """Match the account's pending orders. Never raises: reads must keep working."""
    current = current or datetime.now(TZ)
    try:
        state = store.read(account)
        if not any(o['status'] == 'pending' for o in state['orders']):
            return
        market = gather(state, markets, current)
        store.mutate(account, lambda s: apply_matches(s, market, current))
    except Exception:
        logging.exception('order settlement failed for an account')
