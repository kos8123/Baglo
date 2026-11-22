from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
from baglo.domain import new_account,place_order,demo_match,DomainError
from baglo.portfolio import portfolio
from baglo import ai
from baglo.store import Store

def test_portfolio_cost_available_quantity_and_quote_provenance():
    state,_=place_order(new_account('demo'),{'symbol':'2330','side':'buy','quantity':10,'limit_price':100000},'buy-test')
    state,_=demo_match(state,'buy-test')
    state,_=place_order(state,{'symbol':'2330','side':'sell','quantity':3,'limit_price':110000},'sell-test')
    markets=SimpleNamespace(quote=lambda *args:{'quote':{'price':110000,'as_of':'2026-11-20','source':'fixture','kind':'close'}})
    result=portfolio(state,markets);row=result['items'][0]
    assert row['cost']==1002000 and row['average_price']==100200
    assert row['unrealized_pnl']==98000 and row['available_quantity']==7
    assert row['price_kind']=='close' and result['total_equity']==state['cash']+1100000

def test_ai_missing_key_cannot_enable_auto_or_call_model(tmp_path,monkeypatch):
    monkeypatch.delenv('BAGLO_OPENAI_API_KEY',raising=False);monkeypatch.delenv('BAGLO_OPENAI_SECRET_ARN',raising=False)
    body={'enabled':True,'symbols':['2330'],'budget':1000000,'min_confidence':.7}
    with pytest.raises(DomainError,match='金鑰'):ai.save_settings(new_account('paper'),body)
    with pytest.raises(DomainError,match='金鑰'):ai.enqueue(Store(path=str(tmp_path/'ai.db')),None,'user','2330')
    assert ai.save_settings(new_account('paper'),{**body,'enabled':False})[1]['enabled'] is False

def test_ai_paper_execution_is_idempotent_and_risk_checked(tmp_path,monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None):return datetime(2026,11,23,2,0,tzinfo=timezone.utc).astimezone(tz)
    monkeypatch.setattr(ai,'datetime',Clock)
    store=Store(path=str(tmp_path/'ai.db'))
    def setup(state):
        state['ai_jobs']=[{'id':'recommendation-one','symbol':'2330','status':'completed','created_at':'2026-11-23T01:00:00+00:00','result':{'action':'buy','confidence':.9}}]
        return state,None
    store.mutate('alice',setup)
    markets=SimpleNamespace(quote=lambda *args:{'quote':{'price':100000,'kind':'live','is_realtime':True}},order_instrument=lambda symbol:{'symbol':symbol,'price_limits':{'status':'available','lower':90000,'upper':110000,'as_of':'2026-11-23'}})
    first=ai.execute(store,markets,'alice','recommendation-one')
    assert first['status']=='pending' and first['source']=='ai_recommendation'
    assert ai.execute(store,markets,'alice','recommendation-one')['id']==first['id']
    assert len(store.read('alice')['orders'])==1
    store.mutate('bob',setup)
    with pytest.raises(DomainError,match='已停用'):ai.execute(store,markets,'bob','recommendation-one',automatic=True)
    markets.quote=lambda *args:{'quote':{'price':100000,'kind':'last_trade','is_realtime':False}}
    with pytest.raises(DomainError,match='即時'):ai.execute(store,markets,'bob','recommendation-one')

def test_swagger_contract_covers_ai_orders_and_portfolio():
    from baglo.openapi import document
    contract=document()
    assert contract['openapi']=='3.0.3'
    assert '/api/portfolio' in contract['paths'] and '/api/ai/jobs/{id}/execute' in contract['paths']
    assert contract['paths']['/api/orders']['post']['parameters'][0]['name']=='Idempotency-Key'
    assert contract['paths']['/api/account']['get']['security']
