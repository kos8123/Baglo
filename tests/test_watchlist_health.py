from types import SimpleNamespace
from baglo.store import Store
from baglo import watchlist_health as health


def test_fingerprint_changes_for_positions_and_watchlist_not_cash():
    state = {'watchlist': ['2330', '2317'], 'positions': {'2330': 10}, 'cash': 100}
    key, _ = health.fingerprint(state)
    assert health.fingerprint({**state, 'cash': 200})[0] == key
    assert health.fingerprint({**state, 'watchlist': ['2317', '2330']})[0] == key
    assert health.fingerprint({**state, 'positions': {'2330': 11}})[0] != key
    assert health.fingerprint({**state, 'watchlist': ['2330']})[0] != key


def test_start_deduplicates_same_snapshot(tmp_path, monkeypatch):
    store = Store(path=str(tmp_path/'health.db'))
    monkeypatch.setattr(health.ai, 'configured', lambda: True)
    monkeypatch.delenv('BAGLO_AI_WORKER', raising=False)
    calls = []
    monkeypatch.setattr(health.ai, '_pool', SimpleNamespace(submit=lambda *args: calls.append(args)))
    first = health.start(store, None, 'alice')
    second = health.start(store, None, 'alice')
    assert first['key'] == second['key']
    assert len(calls) == 1
    health.start(store, None, 'bob')
    assert len(calls) == 2


def test_worker_saves_summary_and_ignores_duplicate_event(tmp_path, monkeypatch):
    store = Store(path=str(tmp_path/'health.db'))
    snapshot = {'day': '2026-11-24', 'symbols': ['2330'], 'positions': {}}
    store.mutate('alice', lambda state: ({**state, 'watchlist_health': {
        'key': 'test', 'snapshot': snapshot, 'status': 'queued', 'model': 'test-model'}}, None))
    result = {'summary': '缺少產業資料，僅檢查資料品質。', 'assessment': 'insufficient_data',
              'risks': ['僅追蹤一檔'], 'suggestions': ['補充研究依據'], 'limitations': ['沒有相關性資料']}
    calls = []
    def model(*args):
        calls.append(args)
        return result
    monkeypatch.setattr(health.ai, 'model_response', model)
    markets = SimpleNamespace(index=lambda: {'2330': {'name': '台積電', 'price': 100000, 'as_of': '2026-11-23'}})
    health.run(store, markets, 'alice', 'test')
    health.run(store, markets, 'alice', 'test')
    assert len(calls) == 1
    assert store.read('alice')['watchlist_health']['result'] == result
    assert store.read('alice')['watchlist_health']['status'] == 'completed'


def test_facts_compute_weights_and_flag_unwatched_holdings():
    snapshot = {'day': '2026-11-24', 'symbols': ['2330', '2317'], 'positions': {'2330': 20, '2317': 10, '2313': 9}}
    registry = {'2330': {'name': '台積電', 'price': 200000, 'change': -1000, 'as_of': '2026-11-20', 'turnover': 30_000_000_000},
                '2317': {'name': '鴻海', 'price': 21000, 'as_of': '2026-11-19', 'turnover': 90_000_000}}
    result = health.facts(snapshot, registry)
    assert result['holdings'][0] == {'symbol': '2330', 'name': '台積電', 'value': 40000, 'weight_pct': 95.0}
    assert result['held_not_watched'] == ['2313']
    assert result['missing_price'] == ['2313']
    items = {item['symbol']: item for item in result['items']}
    assert items['2317']['stale_days'] == 1 and items['2330']['stale_days'] == 0
    assert items['2330']['change_pct'] == -0.5 and items['2317']['turnover_million'] == 90.0
