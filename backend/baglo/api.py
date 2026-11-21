"""HTTP API shared by local server and API Gateway Lambda integration."""
import base64
import json
import logging
import os
from .domain import DomainError, UNIVERSE, place_order, cancel_order, demo_match, stock_price_ticks
from .store import Store
from .markets import MarketService, DataUnavailable, numeric

_store = None
_markets = None

def get_markets():
    global _markets
    if _markets is None:
        _markets = MarketService()
    return _markets


def get_store():
    global _store
    if _store is None:
        table_name = os.getenv('BAGLO_TABLE')
        if table_name:
            import boto3
            _store = Store(table=boto3.resource('dynamodb').Table(table_name))
        else:
            _store = Store(mode='demo' if os.getenv('BAGLO_DEMO') == '1' else 'paper')
    return _store

def response(status, body):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
            'body': json.dumps(body, ensure_ascii=False)}

def handler(event, context):
    path = event.get('rawPath', '')
    method = event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    if path == '/api/health' and method == 'GET':
        return response(200, {'ok': True, 'service': 'Baglo', 'trading': 'paper_only'})
    if path == '/api/config' and method == 'GET':
        return response(200, {'environment': os.getenv('BAGLO_ENV', 'local'),
            'demo': os.getenv('BAGLO_DEMO') == '1' and not os.getenv('BAGLO_TABLE'),
            'client_id': os.getenv('BAGLO_CLIENT_ID', ''), 'auth_domain': os.getenv('BAGLO_AUTH_DOMAIN', ''),
            'price_ticks': stock_price_ticks(),
            'symbols': [{'symbol': k, 'name': v} for k, v in UNIVERSE.items()],
            'capabilities': {'manual_orders': True, 'live_quote_matching': False,
                             'ai_recommendations': False, 'ai_auto_trading': False}})
    account = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {}).get('sub')
    if not account:
        return response(401, {'error': '請先登入'})
    try:
        if method == 'GET' and path == '/api/instruments':
            params = event.get('queryStringParameters') or {}
            def price_filter(key):
                raw = params.get(key, '')
                if raw == '':
                    return None
                value = numeric(raw)
                if value is None or value < 0 or value > 100_000:
                    raise DomainError('價格篩選需為 0～100,000 元')
                return int(value*100)
            low, high = price_filter('min_price'), price_filter('max_price')
            if low is not None and high is not None and low > high:
                raise DomainError('最低價格不能高於最高價格')
            return response(200, get_markets().search(params.get('q', ''), low, high))
        parts = path.strip('/').split('/')
        if method == 'GET' and len(parts) == 3 and parts[:2] == ['api', 'market']:
            params = event.get('queryStringParameters') or {}
            return response(200, get_markets().quote(parts[2], params.get('market_type', 'odd_lot')))
        if method == 'GET' and len(parts) == 3 and parts[:2] == ['api', 'history']:
            return response(200, get_markets().history(parts[2]))
        if method == 'GET' and len(parts) == 3 and parts[:2] == ['api', 'research']:
            service = get_markets()
            return response(200, {'symbol': parts[2], 'fundamentals': service.fundamentals(parts[2]), 'ownership': service.ownership(parts[2])})
        if method == 'GET' and path == '/api/account':
            return response(200, get_store().read(account))
        raw = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw).decode()
        if len(raw) > 4096:
            raise DomainError('請求內容太大', 413)
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise DomainError('請求內容必須為 JSON object')
        if method == 'POST' and path == '/api/orders':
            headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
            key = headers.get('idempotency-key')
            prior = get_store().read(account)
            replay = any(o['id'] == key for o in prior['orders'])
            instrument = None if replay else get_markets().order_instrument(body.get('symbol'))
            result = get_store().mutate(account, lambda s: place_order(s, body, key, instrument))
            return response(200, result)
        parts = path.strip('/').split('/')
        if method == 'POST' and len(parts) == 4 and parts[:2] == ['api', 'orders']:
            if parts[3] == 'cancel':
                return response(200, get_store().mutate(account, lambda s: cancel_order(s, parts[2])))
            if parts[3] == 'demo-fill':
                if os.getenv('BAGLO_DEMO') != '1' or os.getenv('BAGLO_TABLE'):
                    raise DomainError('此功能只限本機沙盒', 403)
                return response(200, get_store().mutate(account, lambda s: demo_match(s, parts[2])))
        if method == 'GET' and path == '/api/analysis':
            return response(200, {'status': 'not_configured', 'technical': None, 'fundamental': None,
                'ownership': None, 'recommendations': [],
                'reason': '官方資料可在研究室查閱；AI 分析與自動交易尚未啟用。'})
        return response(404, {'error': '找不到此功能'})
    except DataUnavailable as exc:
        return response(503, {'error': str(exc), 'retryable': True})
    except DomainError as exc:
        return response(exc.status, {'error': str(exc)})
    except (ValueError, TypeError, KeyError, UnicodeError):
        return response(400, {'error': '請求格式不正確'})
    except Exception:
        logging.exception('Baglo API request failed')
        return response(503, {'error': '服務暫時無法使用；請沿用原請求編號重試'})
