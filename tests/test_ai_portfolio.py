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
    # A user-confirmed decision without a live quote uses the reference price and says so.
    fallback=ai.execute(store,markets,'bob','recommendation-one')
    assert fallback['status']=='pending' and '參考價' in fallback['execution_note']


def _clock(monkeypatch,utc):
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None):return utc.astimezone(tz)
    monkeypatch.setattr(ai,'datetime',Clock)


def _markets(quote):
    return SimpleNamespace(quote=lambda *args:{'quote':quote},
                           order_instrument=lambda symbol:{'symbol':symbol,'price_limits':{'status':'available','lower':90000,'upper':110000,'as_of':'2026-11-25'}})


def test_trade_now_outside_session_places_a_next_session_limit_order(tmp_path,monkeypatch):
    _clock(monkeypatch,datetime(2026,11,25,12,30,tzinfo=timezone.utc))  # 20:30 Taipei
    store=Store(path=str(tmp_path/'ai.db'))
    store.mutate('alice',lambda s:(s.update(ai_jobs=[{'id':'j1','symbol':'2330','status':'completed','created_at':'2026-11-25T12:00:00+00:00','result':{'action':'buy','confidence':.8}}]) or s,None))
    markets=_markets({'price':100050,'kind':'close','is_realtime':False})
    order=ai.execute(store,markets,'alice','j1')
    assert order['status']=='pending' and order['limit_price']==100000 and '非交易時段' in order['execution_note']
    store.mutate('bob',lambda s:(s.update(ai_settings={'enabled':True,'symbols':['2330'],'budget':1000000,'min_confidence':.7},
                                          ai_jobs=[{'id':'j1','symbol':'2330','status':'completed','created_at':'2026-11-25T12:00:00+00:00','result':{'action':'buy','confidence':.8}}]) or s,None))
    with pytest.raises(DomainError,match='交易時段'):ai.execute(store,markets,'bob','j1',automatic=True)


def test_trade_now_runs_analysis_then_places_the_order(tmp_path,monkeypatch):
    _clock(monkeypatch,datetime(2026,11,25,12,30,tzinfo=timezone.utc))
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv('BAGLO_DATA_BUCKET',raising=False)
    store=Store(path=str(tmp_path/'ai.db'))
    store.mutate('alice',lambda s:(s.update(ai_jobs=[{'id':'j1','symbol':'2330','status':'queued','auto_execute':True,'created_at':'2026-11-25T12:00:00+00:00'}]) or s,None))
    bars=[{'date':f'2026-08-{i%28+1:02d}','open':100000,'high':100000,'low':100000,'close':100000,'volume':1} for i in range(70)]
    markets=_markets({'price':100000,'kind':'close','is_realtime':False})
    markets.history=lambda symbol,months:{'bars':bars,'as_of':'2026-11-25','sma20':100000,'sma60':100000,'warnings':['20261001 暫無資料']}
    markets.fundamentals=lambda symbol:{'revenue':[1],'valuation':{'pe':10}}
    markets.ownership=lambda symbol:{'status':'available'}
    monkeypatch.setattr(ai,'infer',lambda snapshot,model=None:{'symbol':'2330','action':'buy','confidence':.9,'reason':'r','risk':'k'})
    ai.run(store,markets,'alice','j1','2330')
    state=store.read('alice');job=state['ai_jobs'][0]
    assert job['status']=='completed' and job['order_id'] and '非交易時段' in job['execution_note']
    assert state['orders'][0]['source']=='ai_recommendation'


def test_trade_now_reports_a_hold_without_ordering(tmp_path,monkeypatch):
    _clock(monkeypatch,datetime(2026,11,25,12,30,tzinfo=timezone.utc))
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv('BAGLO_DATA_BUCKET',raising=False)
    store=Store(path=str(tmp_path/'ai.db'))
    store.mutate('alice',lambda s:(s.update(ai_jobs=[{'id':'j1','symbol':'2330','status':'queued','auto_execute':True,'created_at':'2026-11-25T12:00:00+00:00'}]) or s,None))
    bars=[{'date':'2026-08-01','open':1,'high':1,'low':1,'close':1,'volume':1}]*70
    markets=_markets({'price':100000,'kind':'close','is_realtime':False})
    markets.history=lambda symbol,months:{'bars':bars,'as_of':'2026-11-25','sma20':1,'sma60':1,'warnings':[]}
    markets.fundamentals=lambda symbol:{'revenue':[1],'valuation':{'pe':10}}
    markets.ownership=lambda symbol:{'status':'available'}
    monkeypatch.setattr(ai,'infer',lambda snapshot,model=None:{'symbol':'2330','action':'hold','confidence':.9,'reason':'r','risk':'k'})
    ai.run(store,markets,'alice','j1','2330')
    job=store.read('alice')['ai_jobs'][0]
    assert not job.get('order_id') and '觀望' in job['execution_note'] and not store.read('alice')['orders']

def test_swagger_contract_covers_ai_orders_and_portfolio():
    from baglo.openapi import document
    contract=document()
    assert contract['openapi']=='3.0.3'
    assert '/api/portfolio' in contract['paths'] and '/api/ai/jobs/{id}/execute' in contract['paths']
    assert contract['paths']['/api/orders']['post']['parameters'][0]['name']=='Idempotency-Key'
    assert contract['paths']['/api/account']['get']['security']


def test_ai_pool_accepts_verified_stocks_beyond_original_six():
    body={'enabled':False,'symbols':['6488','1101','2330','2317','2454','2308','2881','2882'],'budget':1000000,'min_confidence':.7}
    assert ai.save_settings(new_account('paper'),body)[1]['symbols']==body['symbols']
    for symbols in [['0050'],['6488','6488'],['not-a-stock']]:
        with pytest.raises(DomainError):ai.save_settings(new_account('paper'),{**body,'symbols':symbols})


def test_enqueue_accepts_registry_verified_otc_stock(tmp_path,monkeypatch):
    monkeypatch.setenv('BAGLO_AI_PROVIDER','openai')
    monkeypatch.setenv('BAGLO_OPENAI_API_KEY','fixture-only')
    monkeypatch.delenv('BAGLO_AI_WORKER',raising=False)
    seen=[]
    markets=SimpleNamespace(resolve=lambda symbol: seen.append(symbol) or {'symbol':symbol})
    dispatched=[]
    monkeypatch.setattr(ai,'_pool',SimpleNamespace(submit=lambda *args:dispatched.append(args)))
    store=Store(path=str(tmp_path/'custom-universe.db'))
    result=ai.enqueue(store,markets,'alice','6488')
    assert seen==['6488'] and result['symbol']=='6488' and result['status']=='queued'
    assert len(dispatched)==1


def test_model_probe_never_claims_connection_without_real_expected_response(monkeypatch):
    import json
    monkeypatch.setenv('BAGLO_AI_PROVIDER','openai')
    monkeypatch.setenv('BAGLO_OPENAI_API_KEY','fixture-not-a-real-key')
    monkeypatch.setenv('BAGLO_OPENAI_MODEL','fixture-model')
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):return False
        def read(self,*args):return json.dumps({'status':'completed','output':[{'content':[{'type':'output_text','text':'{"ready":true}'}]}]}).encode()
    seen=[]
    def fetch(request,timeout):
        seen.append(json.loads(request.data));return Response()
    monkeypatch.setattr(ai,'urlopen',fetch)
    result=ai.probe()
    assert result['connected'] is True and result['model']=='fixture-model'
    assert seen[0]['store'] is False and 'holdings' not in seen[0]['input']
    monkeypatch.delenv('BAGLO_OPENAI_API_KEY')
    monkeypatch.delenv('BAGLO_OPENAI_SECRET_ARN',raising=False)
    with pytest.raises(DomainError,match='金鑰'):ai.probe()
