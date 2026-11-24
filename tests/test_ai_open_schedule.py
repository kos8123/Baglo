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
