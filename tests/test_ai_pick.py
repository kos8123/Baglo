from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
from baglo import ai, ai_pick
from baglo.domain import DomainError
from baglo.store import Store


def _clock(monkeypatch, utc):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return utc.astimezone(tz)
    monkeypatch.setattr(ai, 'datetime', Clock)
    monkeypatch.setattr(ai_pick, 'datetime', Clock)


def _markets():
    bars = [{'date': f'2026-{9 + i // 22:02d}-{i % 22 + 1:02d}', 'open': 100000, 'high': 101000, 'low': 99000,
             'close': 100000 + i * 100, 'volume': 1000} for i in range(60)]
    index = {s: {'symbol': s, 'name': n, 'as_of': '2026-11-25', 'price': 100000, 'turnover': 9_000_000_000 - i, 'change': 0}
             for i, (s, n) in enumerate([('2330', '台積電'), ('2317', '鴻海'), ('2454', '聯發科')])}
    return SimpleNamespace(
        index=lambda: index,
        history=lambda symbol, months: {'bars': bars, 'as_of': '2026-11-25', 'warnings': []},
        quote=lambda *args: {'quote': {'price': 100050, 'kind': 'close', 'is_realtime': False}},
        order_instrument=lambda symbol: {'symbol': symbol, 'price_limits': {'status': 'available', 'lower': 90000, 'upper': 110000, 'as_of': '2026-11-25'}})


@pytest.fixture
def setup(tmp_path, monkeypatch):
    _clock(monkeypatch, datetime(2026, 11, 25, 12, 30, tzinfo=timezone.utc))  # 20:30 Taipei
    monkeypatch.setenv('BAGLO_AI_PROVIDER', 'gemini')
    monkeypatch.setenv('BAGLO_GEMINI_API_KEY', 'fixture-only')
    monkeypatch.delenv('BAGLO_AI_WORKER', raising=False)
    monkeypatch.setattr(ai, '_pool', SimpleNamespace(submit=lambda *args: None))
    store = Store(path=str(tmp_path / 'ai.db'))
    return store, _markets()


def test_pick_and_trade_orders_each_confident_pick(setup, monkeypatch):
    store, markets = setup
    seen = {}

    def model(body, timeout):
        seen['candidates'] = [c['symbol'] for c in __import__('json').loads(body['input'][1]['content'])['candidates']]
        return {'summary': '半導體量能放大', 'evaluations': [
            {'symbol': '2330', 'view': 'buy', 'confidence': .82, 'comment': '站上均線'},
            {'symbol': '2317', 'view': 'hold', 'confidence': .4, 'comment': '量縮整理'}], 'picks': [
            {'symbol': '2330', 'action': 'buy', 'confidence': .82, 'reason': '站上均線'},
            {'symbol': '2454', 'action': 'buy', 'confidence': .55, 'reason': '還在整理'},
            {'symbol': '9999', 'action': 'buy', 'confidence': .99, 'reason': '不在候選'}]}
    monkeypatch.setattr(ai, 'model_response', model)
    job = ai_pick.enqueue(store, markets, 'alice')
    ai_pick.run(store, markets, 'alice', job['id'])
    state = store.read('alice')
    parent = next(j for j in state['ai_jobs'] if j['id'] == job['id'])
    assert seen['candidates'] == ['2330', '2317', '2454']
    assert parent['status'] == 'completed' and parent['summary'] == '半導體量能放大'
    assert [p['symbol'] for p in parent['picks']] == ['2330', '2454']
    assert parent['picks'][0]['order_id'] and '非交易時段' in parent['picks'][0]['note']
    assert not parent['picks'][1].get('order_id') and '信心' in parent['picks'][1]['note']
    assert [o['symbol'] for o in state['orders']] == ['2330'] and state['orders'][0]['limit_price'] == 100000
    assert '建立 1 筆' in parent['execution_note']
    views = {e['symbol']: e for e in parent['evaluations']}
    assert views['2330']['picked'] and views['2330']['view'] == 'buy'
    assert not views['2317']['picked'] and views['2317']['comment'] == '量縮整理'
    assert '2454' in views and 'view' not in views['2454']  # unrated candidates are still listed


def test_pick_and_trade_with_no_picks_places_nothing(setup, monkeypatch):
    store, markets = setup
    monkeypatch.setattr(ai, 'model_response', lambda body, timeout: {'summary': '大盤震盪，觀望', 'evaluations': [], 'picks': []})
    job = ai_pick.enqueue(store, markets, 'alice')
    ai_pick.run(store, markets, 'alice', job['id'])
    parent = store.read('alice')['ai_jobs'][-1]
    assert parent['status'] == 'completed' and parent['picks'] == [] and '未下單' in parent['execution_note']
    assert store.read('alice')['orders'] == []


def test_pick_and_trade_runs_one_at_a_time_and_needs_a_model_key(setup, monkeypatch):
    store, markets = setup
    ai_pick.enqueue(store, markets, 'alice')
    with pytest.raises(DomainError, match='進行中'):
        ai_pick.enqueue(store, markets, 'alice')
    monkeypatch.delenv('BAGLO_GEMINI_API_KEY')
    monkeypatch.delenv('BAGLO_GEMINI_SECRET_ARN', raising=False)
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    with pytest.raises(DomainError, match='金鑰'):
        ai_pick.enqueue(store, markets, 'bob')
