from copy import deepcopy
from datetime import date,timedelta,datetime,timezone
import pytest
from baglo.backtest import simulate,validate,slipped,fee,read,write
from baglo.domain import DomainError

def fixture():
    bars=[]
    closes=[10000,10000,11000,9000,8000,8000]
    for i,close in enumerate(closes):
        bars.append({'date':(date(2025,1,6)+timedelta(days=i)).isoformat(),'open':10000,'high':max(10000,close)+100,'low':min(10000,close)-100,'close':close,'volume':1000000})
    body={'symbol':'2330','strategy':'sma','start_date':bars[3]['date'],'end_date':bars[-1]['date'],'initial_cash':10000000,'fast':2,'slow':3,'lookback':2,'slippage_bps':0,'market_type':'odd_lot'}
    return bars,body

def test_signal_uses_previous_close_and_next_open_with_costs():
    bars,body=fixture();result=simulate(bars,body)
    buy,sell=result['trades']
    assert buy['signal_date']==bars[2]['date'] and buy['date']==bars[3]['date']
    assert buy['price']==bars[3]['open'] and buy['price']!=bars[3]['close']
    assert sell['signal_date']==bars[4]['date'] and sell['date']==bars[5]['date']
    assert result['metrics']['final_equity']==body['initial_cash']-sum(t['fee']+t['tax'] for t in result['trades'])
    assert result['metrics']['final_quantity']==0
    changed=deepcopy(bars);changed[3]['close']=25000
    assert simulate(changed,body)['trades'][0]==buy

def test_final_position_is_marked_not_force_sold_and_budget_never_negative():
    bars,body=fixture();result=simulate(bars,body,strategy='buy_hold')
    assert len(result['trades'])==1 and result['trades'][0]['side']=='buy'
    assert result['metrics']['final_quantity']>0 and result['metrics']['taxes']==0
    assert all(point['cash']>=0 for point in result['curve'])
    assert result['metrics']['final_equity']==result['metrics']['final_cash']+result['metrics']['final_quantity']*bars[-1]['close']

def test_slippage_tick_rounding_and_fee_minimum():
    assert slipped(10000,10,True,'2025-01-01')==10050
    assert slipped(10000,10,False,'2025-01-01')==9990
    assert fee(1000)==2000

def test_backtest_validation_and_private_report_access(tmp_path,monkeypatch):
    _,body=fixture();validate(body)
    for changes in [{'fast':4},{'slippage_bps':-1},{'end_date':'2099-01-01'},{'initial_cash':True}]:
        with pytest.raises(DomainError):validate({**body,**changes})
    monkeypatch.chdir(tmp_path);monkeypatch.delenv('BAGLO_DATA_BUCKET',raising=False)
    report={'id':'12345678-1234-1234-1234-123456789abc','status':'completed','created_at':'2025-01-01T00:00:00+00:00'}
    write('alice',report);assert read('alice',report['id'])==report
    with pytest.raises(DomainError):read('bob',report['id'])


def test_complete_report_keeps_holdout_parameters_fixed_and_does_not_touch_ledger(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from baglo import backtest
    monkeypatch.chdir(tmp_path);monkeypatch.delenv('BAGLO_DATA_BUCKET',raising=False)
    bars=[]
    for i in range(160):
        day=date(2025,1,1)+timedelta(days=i)
        price=10000+i*10
        bars.append({'date':day.isoformat(),'open':price,'high':price+100,'low':price-100,'close':price+50,'volume':1000000})
    _,body=fixture();body.update(start_date='2025-03-01',end_date='2025-05-31')
    job={'id':'12345678-1234-1234-1234-123456789abc','status':'queued','request':body,'created_at':datetime.now(timezone.utc).isoformat()}
    write('alice',job)
    markets=SimpleNamespace(history=lambda *args,**kwargs:{'bars':bars,'warnings':[]})
    backtest.run('alice',job['id'],markets)
    result=read('alice',job['id'])
    assert result['status']=='completed'
    assert result['result']['development']['end_date']<result['result']['holdout']['start_date']
    assert result['result']['holdout']['metrics']['final_cash']>=0
    assert not (tmp_path/'data/baglo.db').exists()


def test_invalid_liquidity_cannot_create_negative_position():
    bars,body=fixture()
    for bar in bars:bar['volume']=-1
    result=simulate(bars,body)
    assert result['trades']==[] and result['metrics']['final_quantity']==0
    assert result['metrics']['final_cash']==body['initial_cash']
