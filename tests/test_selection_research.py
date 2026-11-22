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
