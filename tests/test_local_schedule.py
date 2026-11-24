from datetime import datetime
from zoneinfo import ZoneInfo
from baglo.local_schedule import tick
from baglo.store import Store
from baglo import ai
from baglo.domain import DomainError


def test_local_schedule_is_opt_in_and_does_not_reenqueue(tmp_path,monkeypatch):
    store=Store(path=str(tmp_path/'scheduler.db'))
    calls=[]
    monkeypatch.setattr(ai,'enqueue',lambda *args:calls.append(args))
    current=datetime(2026,11,23,8,40,tzinfo=ZoneInfo('Asia/Taipei'))
    tick(store,None,current)
    assert not calls
    def enable(state):
        state['ai_settings']={'enabled':True,'symbols':['6488'],'budget':1000000,'min_confidence':.7}
        state['ai_jobs']=[{'id':'daily-2026-11-23-6488','status':'failed'}]
        return state,None
    store.mutate('local-demo',enable)
    tick(store,None,current)
    assert not calls


def test_local_schedule_attempts_completed_signal_once(tmp_path,monkeypatch):
    store=Store(path=str(tmp_path/'scheduler.db'))
    def setup(state):
        state['ai_settings']={'enabled':True,'symbols':['2330'],'budget':1000000,'min_confidence':.7}
        state['ai_jobs']=[{'id':'daily-2026-11-23-2330','status':'completed'}]
        return state,None
    store.mutate('local-demo',setup)
    calls=[]
    def execute(*args,**kwargs):
        calls.append(kwargs)
        raise DomainError('缺少即時行情')
    monkeypatch.setattr(ai,'execute',execute)
    current=datetime(2026,11,23,9,10,tzinfo=ZoneInfo('Asia/Taipei'))
    tick(store,None,current);tick(store,None,current)
    assert calls==[{'automatic':True}]
    assert store.read('local-demo')['ai_jobs'][0]['execution_note']=='缺少即時行情'
