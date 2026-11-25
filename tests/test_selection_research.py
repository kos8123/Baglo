from datetime import date,timedelta
from types import SimpleNamespace
import pytest
from baglo import selection_research as sr
from baglo import backtest
from baglo.domain import DomainError


def test_proposal_rejects_unexecutable_model_parameters(monkeypatch):
    from baglo import ai
    monkeypatch.setattr(ai,'model_response',lambda *args:{'strategy':'exec','fast':3,'slow':40,'lookback':10,'reason':'bad'})
    with pytest.raises(DomainError):sr.propose('2330',[])


def test_market_shortlist_is_liquid_auditable_and_keeps_holdings():
    rows={
        '2330':{'symbol':'2330','price':100000,'change':1000,'turnover':900_000_000,'as_of':'2026-11-23','stale_cache':False},
        '2317':{'symbol':'2317','price':20000,'change':100,'turnover':500_000_000,'as_of':'2026-11-23','stale_cache':False},
        '1101':{'symbol':'1101','price':4000,'change':0,'turnover':1_000_000,'as_of':'2026-11-23','stale_cache':False},
        '6488':{'symbol':'6488','price':40000,'change':0,'turnover':None,'as_of':'2026-11-23','stale_cache':False},
    }
    symbols,audit=sr.market_shortlist(SimpleNamespace(index=lambda:rows),['1101'],limit=3)
    assert symbols==['1101','2330','2317']
    assert audit['market_total']==4 and audit['held_included']==1 and audit['minimum_turnover']==20_000_000


def test_research_skips_incomplete_history_until_twelve_valid_stocks(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    symbols=[f'{1000+i}' for i in range(13)]
    bars=[]
    start=date(2025,11,1)
    for i in range(240):
        close=10000+i*10
        bars.append({'date':(start+timedelta(days=i)).isoformat(),'open':close,'high':close+100,'low':close-100,'close':close,'volume':1000000})
    job={'id':'33333333-3333-4333-8333-333333333333','status':'queued','created_at':sr.datetime.now().astimezone().isoformat(),'symbols':symbols,'results':[],'skipped':[],'model':'fixture-model','notes':[]}
    backtest.write('alice',job)
    monkeypatch.setattr(sr,'propose',lambda *args:{'strategy':'sma','fast':5,'slow':35,'lookback':15,'reason':'fixture'})
    def history(symbol,**kwargs):
        return {'bars':bars,'warnings':['missing']} if symbol==symbols[0] else {'bars':bars,'warnings':[]}
    sr.run('alice',job['id'],SimpleNamespace(resolve=lambda s:None,history=history))
    result=backtest.read('alice',job['id'])
    assert len(result['results'])==12 and len(result['skipped'])==1
    assert result['skipped'][0]['symbol']==symbols[0]


def test_research_model_receives_only_development_and_never_changes_ledger(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    bars=[]
    start=date(2025,11,1)
    for i in range(240):
        close=10000+i*20
        bars.append({'date':(start+timedelta(days=i)).isoformat(),'open':close,'high':close+100,'low':close-100,'close':close,'volume':1000000})
    job={'id':'11111111-1111-4111-8111-111111111111','status':'queued','created_at':sr.datetime.now().astimezone().isoformat(),'symbols':['2330'],'results':[],'model':'fixture-model','notes':[]}
    backtest.write('alice',job)
    seen=[]
    def propose(symbol,development,model):
        seen.append((development,model))
        return {'strategy':'sma','fast':10,'slow':40,'lookback':20,'reason':'fixture'}
    monkeypatch.setattr(sr,'propose',propose)
    sr.run('alice',job['id'],SimpleNamespace(resolve=lambda s:None,history=lambda *args,**kwargs:{'bars':bars,'warnings':[]}))
    result=backtest.read('alice',job['id'])
    assert len(seen[0][0])==144 and seen[0][1]=='fixture-model'
    assert result['status']=='completed'
    row=result['results'][0]
    assert row['validation']['start_date']==bars[144]['date']
    assert row['final_test']['start_date']==bars[192]['date']
    assert result['selected_symbol'] is None  # One buy is insufficient evidence.
    assert 'frozen_strategies' not in sr.public(result)
    with pytest.raises(DomainError):backtest.read('bob',job['id'])


def test_cloud_worker_claim_prevents_duplicate_model_calls(tmp_path,monkeypatch):
    from baglo import api
    from baglo.store import Store
    monkeypatch.chdir(tmp_path)
    store=Store(path=str(tmp_path/'cloud.db'))
    job_id='22222222-2222-4222-8222-222222222222'
    backtest.write('alice',{'id':job_id,'status':'queued','created_at':sr.datetime.now().astimezone().isoformat(),'symbols':['2330','2317'],'results':[]})
    def setup(state):
        state['ai_selection_job']=job_id
        return state,None
    store.mutate('alice',setup)
    monkeypatch.setattr(api,'get_store',lambda:store)
    monkeypatch.setattr(api,'get_markets',lambda:None)
    calls=[]
    monkeypatch.setattr(sr,'run',lambda *args:calls.append(args))
    event={'account':'alice','job_id':job_id,'index':0}
    assert sr.worker(event,None)['status']=='processed'
    assert sr.worker(event,None)['status']=='duplicate_or_obsolete'
    assert len(calls)==1


def test_cloud_start_dispatches_lambda_instead_of_background_thread(tmp_path,monkeypatch):
    from baglo.store import Store
    from baglo import ai
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('BAGLO_TABLE','fixture-ledger')
    monkeypatch.setenv('BAGLO_SELECTION_WORKER','fixture-worker')
    monkeypatch.setattr(ai,'configured',lambda:True)
    calls=[]
    monkeypatch.setattr(sr,'dispatch',lambda *args:calls.append(args))
    store=Store(path=str(tmp_path/'cloud-start.db'))
    result=sr.start(store,None,'alice')
    assert calls==[('alice',result['id'],0)]
    assert sr.start(store,None,'alice')['id']==result['id']
    assert len(calls)==1


def test_market_shortlist_judges_freshness_per_exchange():
    rows={
        '2330':{'symbol':'2330','name':'台積電','exchange':'TWSE','as_of':'2026-11-24','price':223000,'turnover':90_000_000_000,'change':0},
        '1101':{'symbol':'1101','name':'台泥','exchange':'TWSE','as_of':'2026-11-20','price':3000,'turnover':80_000_000_000,'change':0},
        '6274':{'symbol':'6274','name':'台燿','exchange':'TPEx','as_of':'2026-11-25','price':74600,'turnover':5_000_000_000,'change':0},
    }
    symbols,_=sr.market_shortlist(SimpleNamespace(index=lambda:rows),limit=5)
    assert symbols==['2330','6274']
