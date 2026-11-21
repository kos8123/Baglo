import copy
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from baglo.domain import DomainError, INITIAL_CASH, new_account, place_order, cancel_order, demo_match
from baglo.store import Store
from baglo import api

BODY = {'symbol': '2330', 'side': 'buy', 'quantity': 10, 'limit_price': 100_000}

def test_reserved_cash_and_cancel_release_without_changing_balance():
    state, order = place_order(new_account('paper'), BODY, 'order-one')
    assert state['cash'] == INITIAL_CASH
    assert order['reserved'] == 1_002_000
    cancelled, result = cancel_order(state, 'order-one')
    assert result['status'] == 'cancelled'
    assert cancelled['cash'] == INITIAL_CASH
    assert cancel_order(cancelled, 'order-one')[0] == cancelled

def test_duplicate_request_and_conflicting_payload():
    state, first = place_order(new_account('paper'), BODY, 'order-one')
    assert place_order(state, BODY, 'order-one') == (state, first)
    with pytest.raises(DomainError, match='不同委託'):
        place_order(state, {**BODY, 'quantity': 11}, 'order-one')

@pytest.mark.parametrize('field,value', [('quantity', True), ('quantity', 0), ('quantity', 1.5), ('quantity', '1'), ('limit_price', 0), ('symbol', 'EVIL'), ('side', 'short')])
def test_reject_invalid_orders(field, value):
    with pytest.raises(DomainError):
        place_order(new_account('paper'), {**BODY, field: value}, 'order-one')

def test_reject_oversized_order_and_naked_short_and_client_injected_fill():
    for body in [{**BODY, 'quantity': 100}, {**BODY, 'side': 'sell'}, {**BODY, 'status': 'filled'}]:
        with pytest.raises(DomainError):
            place_order(new_account('paper'), body, 'order-one')

def test_pending_orders_cannot_overreserve_shared_cash():
    state = new_account('paper')
    for i in range(5):
        state, _ = place_order(state, {**BODY, 'quantity': 50}, f'order-{i:03}')
    with pytest.raises(DomainError, match='資金不足'):
        place_order(state, {**BODY, 'quantity': 50}, 'order-six')

def test_demo_roundtrip_costs_and_sell_reservations():
    state, _ = place_order(new_account('demo'), BODY, 'order-buy')
    state, bought = demo_match(state, 'order-buy')
    assert state['cash'] == INITIAL_CASH - 1_002_000
    assert state['positions']['2330'] == 10
    assert bought['fill_source'] == 'sandbox_limit_price'
    assert demo_match(state, 'order-buy')[0] == state
    state, _ = place_order(state, {**BODY, 'side': 'sell'}, 'order-sell')
    with pytest.raises(DomainError, match='股數不足'):
        place_order(state, {**BODY, 'side': 'sell', 'quantity': 1}, 'sell-more')
    state, sold = demo_match(state, 'order-sell')
    assert sold['fee'] == 2000 and sold['tax'] == 3000
    assert state['cash'] == INITIAL_CASH - 7000
    assert state['positions']['2330'] == 0

def test_paper_mode_can_never_use_demo_match():
    state, _ = place_order(new_account('paper'), BODY, 'order-buy')
    with pytest.raises(DomainError):
        demo_match(state, 'order-buy')

def test_sqlite_durable_isolated_accounts_and_concurrent_retries(tmp_path):
    path = str(tmp_path / 'state.db')
    store = Store(mode='demo', path=path)
    def submit(_):
        return store.mutate('alice', lambda s: place_order(s, BODY, 'same-key'))
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(submit, range(18)))
    assert all(o['id'] == 'same-key' for o in results)
    state = Store(mode='demo', path=path).read('alice')
    assert len(state['orders']) == 1 and state['version'] == 1
    assert store.read('bob')['orders'] == []
    def unique(i):
        return store.mutate('alice', lambda s: place_order(s, {**BODY, 'quantity': 1}, f'unique-{i:03}'))
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(unique, range(12)))
    assert len(store.read('alice')['orders']) == 13

def test_dynamodb_conflict_reloads_before_mutating():
    class Conditional(Exception):
        response = {'Error': {'Code': 'ConditionalCheckFailedException'}}
    class Table:
        calls = 0
        item = None
        def get_item(self, **kwargs):
            assert kwargs['ConsistentRead'] is True
            return {'Item': self.item} if self.item else {}
        def put_item(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                state, _ = place_order(new_account('paper'), {**BODY, 'quantity': 1}, 'other-key')
                state['version'] = 1
                self.item = {'pk': 'alice', 'version': 1, 'data': json.dumps(state)}
                raise Conditional()
            assert kwargs['ConditionExpression'] == '#v = :old'
            assert kwargs['ExpressionAttributeValues'] == {':old': 1}
            self.item = kwargs['Item']
    table = Table()
    store = Store(table=table)
    store.mutate('alice', lambda s: place_order(s, BODY, 'same-key'))
    assert len(store.read('alice')['orders']) == 2
    assert store.read('alice')['version'] == 2

@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_store', Store(mode='demo', path=str(tmp_path/'db')))
    monkeypatch.setenv('BAGLO_DEMO', '1')
    monkeypatch.delenv('BAGLO_TABLE', raising=False)
    return api

def event(path, method='GET', body=None, user='alice', key='test-key'):
    context = {'http': {'method': method}}
    if user:
        context['authorizer'] = {'jwt': {'claims': {'sub': user}}}
    return {'rawPath': path, 'requestContext': context, 'headers': {'Idempotency-Key': key},
            'body': json.dumps(body) if body is not None else ''}

def test_authentication_and_health(service):
    assert service.handler(event('/api/account', user=None), None)['statusCode'] == 401
    assert service.handler(event('/api/health', user=None), None)['statusCode'] == 200
    response = service.handler(event('/api/config', user=None), None)
    assert not json.loads(response['body'])['capabilities']['ai_auto_trading']

def test_api_replay_cross_user_and_cloud_demo_denial(service, monkeypatch):
    assert service.handler(event('/api/orders', 'POST', BODY), None)['statusCode'] == 200
    assert service.handler(event('/api/orders', 'POST', BODY), None)['statusCode'] == 200
    assert len(json.loads(service.handler(event('/api/account'), None)['body'])['orders']) == 1
    denied = service.handler(event('/api/orders/test-key/cancel', 'POST', {}, user='bob'), None)
    assert denied['statusCode'] == 404
    monkeypatch.setenv('BAGLO_TABLE', 'cloud-table')
    denied = service.handler(event('/api/orders/test-key/demo-fill', 'POST', {}), None)
    assert denied['statusCode'] == 403

def test_malformed_body_and_missing_analysis_are_explicit(service):
    malformed = event('/api/orders', 'POST')
    malformed['body'] = '{'
    assert service.handler(malformed, None)['statusCode'] == 400
    analysis = json.loads(service.handler(event('/api/analysis'), None)['body'])
    assert analysis['status'] == 'not_configured' and analysis['recommendations'] == []
