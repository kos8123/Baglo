from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
from unittest.mock import patch

import pytest
from baglo.markets import Cache, DataUnavailable, MarketService, SOURCES, cents, iso_date, normalize_prices
from baglo.domain import DomainError, new_account, place_order, stock_price_tick
from baglo import api

NOW = datetime(2026,11,20,3,tzinfo=timezone.utc)
TWSE = [
    {'Date':'1151120','Code':'2330','Name':'台積電','ClosingPrice':'2,000.00','Change':'-30.00'},
    {'Date':'1151120','Code':'2317','Name':'鴻海','ClosingPrice':'220.50','Change':'0'},
    {'Date':'1151120','Code':'2881','Name':'富邦金','ClosingPrice':'80.00','Change':'0'},
    {'Date':'1151120','Code':'0050','Name':'ETF','ClosingPrice':'50.00'},
    {'Date':'1151120','Code':'9103','Name':'TDR','ClosingPrice':'20.00'},
]
TPEX = [{'Date':'1151120','SecuritiesCompanyCode':'6488','CompanyName':'環球晶','Close':'400.00','Change':'2.50'},
        {'Date':'1151120','SecuritiesCompanyCode':'123456','CompanyName':'權證','Close':'1.00'}]

@pytest.fixture
def service(tmp_path):
    def fetch(url, headers=None):
        if url == SOURCES['twse_prices']: return TWSE
        if url == SOURCES['tpex_prices']: return TPEX
        raise DataUnavailable('fixture has no dataset')
    return MarketService(Cache(directory=tmp_path,clock=lambda:NOW),fetcher=fetch,clock=lambda:NOW)

@pytest.mark.parametrize('value,expected',[('1151120','2026-11-20'),('115/11/20','2026-11-20'),('2026-11-20','2026-11-20'),('20261120','2026-11-20')])
def test_official_date_formats(value, expected):
    assert iso_date(value)==expected

def test_public_price_parsing_and_scope():
    assert cents('2,000.00')==200000
    for value in ['--','NaN','0','',None]: assert cents(value) is None
    data=normalize_prices(TWSE,'TWSE',NOW.isoformat())
    assert {r['symbol'] for r in data}=={'2330','2317','2881'}
    assert data[0]['price']==200000 and data[0]['change']==-3000
    with pytest.raises(DataUnavailable): normalize_prices({'error':'not data'},'TWSE',NOW.isoformat())

def test_search_code_name_suffix_price_and_otc(service):
    assert service.search('台積')['items'][0]['symbol']=='2330'
    assert service.search('臺積電')['items'][0]['symbol']=='2330'
    assert service.search('２３３０')['items'][0]['symbol']=='2330'
    assert service.search('2330.TW')['items'][0]['symbol']=='2330'
    assert service.search('6488')['items'][0]['exchange']=='TPEx'
    assert {r['symbol'] for r in service.search('',5000,25000)['items']}=={'2317','2881'}
    assert service.search('不存在')['total']==0
    assert service.search('0050')['total']==0

def test_cache_stale_failure_is_labelled_and_backed_off(tmp_path):
    now=[NOW]
    cache=Cache(directory=tmp_path,clock=lambda:now[0])
    calls=[]
    def fetch():
        calls.append(1)
        if len(calls)>1: raise OSError('offline')
        return [{'value':1}]
    first=cache.get('source',fetch,ttl=30)
    assert not first['stale_cache']
    cache.get('source',fetch,ttl=30)
    assert len(calls)==1
    now[0]+=timedelta(seconds=31)
    assert cache.get('source',fetch,ttl=30)['stale_cache']
    assert cache.get('source',fetch,ttl=30)['fetched_at']==first['fetched_at']
    assert len(calls)==2
    now[0]+=timedelta(days=8)
    with pytest.raises(DataUnavailable):cache.get('source',fetch)

def test_cache_parallel_reads_fetch_once_and_persist(tmp_path):
    cache=Cache(directory=tmp_path,clock=lambda:NOW)
    calls=[]
    def fetch():calls.append(1);return {'value':12}
    with ThreadPoolExecutor(max_workers=8) as pool:
        values=list(pool.map(lambda _:cache.get('one',fetch),range(16)))
    assert len(calls)==1 and all(v['data']=={'value':12} for v in values)
    other=Cache(directory=tmp_path,clock=lambda:NOW)
    assert other.get('one',lambda:pytest.fail('must read persisted cache'))['data']=={'value':12}

def test_one_offline_exchange_does_not_block_other_search(tmp_path):
    def fetch(url, headers=None):
        if url==SOURCES['twse_prices']:return TWSE
        raise OSError('offline')
    service=MarketService(Cache(directory=tmp_path,clock=lambda:NOW),fetcher=fetch,clock=lambda:NOW)
    data=service.search('2330')
    assert len(data['items'])==1
    assert {'source':'TPEx','status':'unavailable'} in data['sources']

def test_close_fallback_is_not_an_odd_lot_quote(service,monkeypatch):
    monkeypatch.delenv('BAGLO_FUGLE_API_KEY',raising=False)
    monkeypatch.delenv('BAGLO_FUGLE_SECRET_ARN',raising=False)
    q=service.quote('2330','odd_lot')['quote']
    assert not q['is_realtime'] and q['kind']=='close'
    assert q['market_type']=='daily_reference'
    assert q['price']==200000

def test_fugle_separates_venues_and_never_uses_trial_price(service,monkeypatch,tmp_path):
    monkeypatch.setenv('BAGLO_FUGLE_API_KEY','fake-test-key')
    old=service.fetcher
    calls=[]
    def fetch(url,headers=None):
        if 'api.fugle.tw' not in url:return old(url,headers)
        assert headers['X-API-KEY']=='fake-test-key'
        calls.append(url)
        odd='type=oddlot' in url
        return {'symbol':'2330','lastTrade':{'price':2005 if odd else 2000,'time':int(NOW.timestamp()*1e6)},
                'lastPrice':9999,'lastTrial':{'price':9999},'isTrial':False}
    service.fetcher=fetch
    regular=service.quote('2330','board_lot')['quote']
    odd=service.quote('2330','odd_lot')['quote']
    assert regular['price']==200000 and odd['price']==200500
    assert regular['is_realtime'] and odd['is_realtime']
    service.quote('2330','odd_lot')
    assert len(calls)==2
    assert all('fake-test-key' not in p.read_text() for p in tmp_path.glob('*.json'))

def test_stale_or_closed_fugle_trade_not_marked_live(service,monkeypatch):
    monkeypatch.setenv('BAGLO_FUGLE_API_KEY','fake-test-key')
    old=service.fetcher
    service.fetcher=lambda url,headers=None: old(url,headers) if 'api.fugle.tw' not in url else {
        'symbol':'2330','lastTrade':{'price':2000,'time':int((NOW-timedelta(minutes=5)).timestamp()*1e6)},'isClose':True}
    quote=service.quote('2330','odd_lot')['quote']
    assert quote['kind']=='last_trade' and not quote['is_realtime']

def test_history_skips_future_and_never_invents_missing_months(service,monkeypatch):
    old=service.fetcher
    def fetch(url,headers=None):
        if 'STOCK_DAY?' not in url:return old(url,headers)
        return {'stat':'OK','fields':['日期','開盤價','最高價','最低價','收盤價','成交股數'],
                'data':[['115/11/19','1990','2010','1980','2000','1,000'],
                        ['115/11/20','2000','2020','1980','2010','2,000'],
                        ['115/11/21','2000','2050','1980','2040','3,000']]}
    service.fetcher=fetch
    monkeypatch.setattr('baglo.markets.time.sleep',lambda _:None)
    data=service.history('2330')
    assert len(data['bars'])==2 and data['bars'][-1]['date']=='2026-11-20'
    assert data['sma20'] is None and not data['adjusted']
    assert service.history('6488')['bars']==[]

def test_fundamentals_missing_values_stay_missing_and_revenue_period_preserved(service):
    old=service.fetcher
    def fetch(url,headers=None):
        if url==SOURCES['twse_revenue']:return [{'公司代號':'2330','資料年月':'11510','出表日期':'1151117','營業收入-去年同月增減(%)':'12.5','營業收入-上月比較增減(%)':'--'}]
        if url==SOURCES['twse_valuation']:return [{'Code':'2330','Date':'1151120','PEratio':'20','PBratio':'--','DividendYield':'1.2'}]
        return old(url,headers)
    service.fetcher=fetch
    result=service.fundamentals('2330')
    assert result['revenue']['period']=='11510'
    assert result['revenue']['mom_percent'] is None
    assert result['valuation']['pb'] is None
    assert result['revenue']['report_date']=='2026-11-17'

def test_nondefault_instrument_requires_server_metadata():
    body={'symbol':'6488','side':'buy','quantity':10,'limit_price':40000,'market_type':'odd_lot'}
    with pytest.raises(DomainError):place_order(new_account('paper'),body,'otc-test')
    state,order=place_order(new_account('paper'),body,'otc-test',{'symbol':'6488','name':'環球晶','instrument_type':'common_stock','trading_unit':1000})
    assert order['name']=='環球晶'
    assert state['cash']==30000000

@pytest.mark.parametrize('price,tick',[(999,1),(1000,5),(4995,5),(5000,10),(10000,50),(50000,100),(100000,500)])
def test_stock_tick_boundaries(price,tick):
    assert stock_price_tick(price,date(2026,11,21))==tick

def test_announced_top_price_tick_change():
    assert stock_price_tick(200000,date(2027,7,4))==500
    assert stock_price_tick(200000,date(2027,7,5))==100

def test_server_rejects_invalid_price_tick():
    body={'symbol':'2330','side':'buy','quantity':1,'limit_price':200001}
    with pytest.raises(DomainError,match='升降單位'):place_order(new_account('paper'),body,'bad-tick')

def test_market_routes_require_auth_and_filter_validation(service,monkeypatch):
    monkeypatch.setattr(api,'_markets',service)
    base={'requestContext':{'http':{'method':'GET'},'authorizer':{'jwt':{'claims':{'sub':'alice'}}}},'rawPath':'/api/instruments','queryStringParameters':{'q':'環球晶'}}
    result=api.handler(base,None)
    assert result['statusCode']==200 and json.loads(result['body'])['items'][0]['symbol']=='6488'
    base['queryStringParameters']={'min_price':'500','max_price':'100'}
    assert api.handler(base,None)['statusCode']==422
    base['requestContext'].pop('authorizer')
    assert api.handler(base,None)['statusCode']==401


def test_otc_history_lots_convert_to_shares(service,monkeypatch):
    old=service.fetcher
    def fetch(url,headers=None):
        if 'tradingStock?' not in url:return old(url,headers)
        return {'stat':'ok','code':'6488','tables':[{'fields':['日 期','成交張數','開盤','最高','最低','收盤'],
            'data':[['115/11/20','1,234.5','400','450','390','440']]}]}
    service.fetcher=fetch
    monkeypatch.setattr('baglo.markets.time.sleep',lambda _:None)
    data=service.history('6488')
    assert data['source']=='TPEx'
    assert data['bars'][0]['volume']==1234500
    assert data['bars'][0]['close']==44000


def test_otc_ownership_normalizes_whitespace_in_official_fields(service):
    old=service.fetcher
    def fetch(url,headers=None):
        if url==SOURCES['tpex_institutions']:
            return [{'Date':'1151120','SecuritiesCompanyCode':'6488',
                'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference':'1,000',
                'SecuritiesInvestmentTrustCompanies-Difference':'-200','Dealers-Difference':'300','TotalDifference':'1100'}]
        return old(url,headers)
    service.fetcher=fetch
    data=service.ownership('6488')
    assert data['status']=='available' and data['foreign_net_shares']==1000
    assert data['trust_net_shares']==-200 and data['total_net_shares']==1100


def test_order_replay_does_not_require_upstream_market_service(tmp_path,monkeypatch):
    from baglo.store import Store
    store=Store(path=str(tmp_path/'account.db'))
    body={'symbol':'6488','side':'buy','quantity':10,'limit_price':40000,'market_type':'odd_lot'}
    metadata={'symbol':'6488','name':'環球晶','instrument_type':'common_stock','trading_unit':1000}
    store.mutate('alice',lambda s:place_order(s,body,'replay-id',metadata))
    class Offline:
        def order_instrument(self,symbol):pytest.fail('A known idempotent replay must not fetch market data')
    monkeypatch.setattr(api,'_store',store)
    monkeypatch.setattr(api,'_markets',Offline())
    event={'requestContext':{'http':{'method':'POST'},'authorizer':{'jwt':{'claims':{'sub':'alice'}}}},
           'rawPath':'/api/orders','headers':{'Idempotency-Key':'replay-id'},'body':json.dumps(body)}
    assert api.handler(event,None)['statusCode']==200
    event['body']=json.dumps({**body,'quantity':11})
    assert api.handler(event,None)['statusCode']==409
    assert len(store.read('alice')['orders'])==1
