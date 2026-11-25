import pytest
from baglo.ai import AI_REGISTRY, register, scheduled_accounts
from baglo.domain import DomainError
from baglo.store import Store


@pytest.fixture
def store(tmp_path):
    return Store(path=str(tmp_path/'ledger.db'))


def test_listed_accounts_ignore_the_registry(store, monkeypatch):
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', 'alice, bob')
    register(store, 'carol', True)
    assert scheduled_accounts(store) == ['alice', 'bob']
    assert 'ai_accounts' not in store.read(AI_REGISTRY)


def test_open_schedule_tracks_opt_in_and_opt_out(store, monkeypatch):
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', '*')
    register(store, 'alice', True)
    register(store, 'bob', True)
    register(store, 'alice', True)
    assert scheduled_accounts(store) == ['alice', 'bob']
    register(store, 'alice', False)
    register(store, 'nobody', False)
    assert scheduled_accounts(store) == ['bob']


def test_open_schedule_is_capped(store, monkeypatch):
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', '*')
    monkeypatch.setenv('BAGLO_AI_MAX_ACCOUNTS', '2')
    register(store, 'alice', True)
    register(store, 'bob', True)
    with pytest.raises(DomainError, match='名額已滿'):
        register(store, 'carol', True)
    register(store, 'bob', False)
    register(store, 'carol', True)
    assert scheduled_accounts(store) == ['alice', 'carol']


def test_enabled_account_missing_from_registry_is_added_back(store, monkeypatch):
    from baglo.ai import ensure_registered
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', '*')
    enabled = {'ai_settings': {'enabled': True, 'symbols': ['2330'], 'budget': 1000000, 'min_confidence': 0.7}}
    assert ensure_registered(store, 'alice', enabled) is True
    assert scheduled_accounts(store) == ['alice']
    assert ensure_registered(store, 'bob', {}) is False
    assert scheduled_accounts(store) == ['alice']


def test_ensure_registered_reports_a_full_quota(store, monkeypatch):
    from baglo.ai import ensure_registered
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', '*')
    monkeypatch.setenv('BAGLO_AI_MAX_ACCOUNTS', '1')
    enabled = {'ai_settings': {'enabled': True, 'symbols': ['2330'], 'budget': 1000000, 'min_confidence': 0.7}}
    register(store, 'alice', True)
    assert ensure_registered(store, 'bob', enabled) is False
    assert scheduled_accounts(store) == ['alice']


def test_new_accounts_start_with_auto_trading_on_in_open_mode(monkeypatch):
    from baglo.ai import settings
    monkeypatch.setenv('BAGLO_AI_PROVIDER', 'gemini')
    monkeypatch.setenv('BAGLO_GEMINI_API_KEY', 'fixture-only')
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', '*')
    assert settings({})['enabled'] is True
    assert settings({'ai_settings': {'enabled': False, 'symbols': ['2330'], 'budget': 1000000, 'min_confidence': .7}})['enabled'] is False
    monkeypatch.setenv('BAGLO_AI_ACCOUNTS', 'alice')
    assert settings({})['enabled'] is False
