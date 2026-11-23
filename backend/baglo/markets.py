"""Public TWSE/TPEx data with explicit provenance; optional Fugle reference quotes.

No snapshot or last trade is ever used to fill an order here.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from .domain import DomainError, UNIVERSE

TZ = ZoneInfo('Asia/Taipei')
SOURCES = {
    'twse_prices': 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    'tpex_prices': 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    'twse_revenue': 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',
    'tpex_revenue': 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O',
    'twse_valuation': 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL',
    'tpex_valuation': 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis',
    'tpex_institutions': 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading',
}

class DataUnavailable(RuntimeError):
    pass

def utcnow():
    return datetime.now(timezone.utc)

def numeric(value):
    try:
        number = Decimal(str(value).strip().replace(',', '').replace('%', ''))
        return number if number.is_finite() else None
    except (InvalidOperation, ValueError):
        return None

def cents(value):
    number = numeric(value)
    return int((number*100).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) if number is not None and number > 0 else None

def number(value):
    result = numeric(value)
    return float(result) if result is not None else None

def iso_date(value):
    text = str(value or '').strip()
    try:
        if re.fullmatch(r'\d{7}', text):
            return date(int(text[:3])+1911, int(text[3:5]), int(text[5:])).isoformat()
        if re.fullmatch(r'\d{8}', text):
            return date(int(text[:4]), int(text[4:6]), int(text[6:])).isoformat()
        parts = re.split(r'[-/]', text)
        if len(parts) == 3:
            year, month, day = map(int, parts)
            return date(year+1911 if year < 1911 else year, month, day).isoformat()
    except ValueError:
        pass
    raise DataUnavailable('資料日期無法辨識')

def fetch_json(url, headers=None):
    request = Request(url, headers={'User-Agent': 'Baglo/0.1 public-market-research',
                                   'Accept': 'application/json', **(headers or {})})
    with urlopen(request, timeout=4) as response:
        data = response.read(8_000_001)
        if len(data) > 8_000_000:
            raise DataUnavailable('資料回應過大')
        return json.loads(data.decode('utf-8-sig'))

class Cache:
    def __init__(self, directory=None, bucket=None, clock=utcnow):
        self.directory = Path(directory or os.getenv('BAGLO_MARKET_CACHE', 'data/market-cache'))
        self.bucket, self.clock = bucket, clock
        self.memory, self.locks, self.guard = {}, {}, threading.Lock()
        self.failed_until = {}

    def lock(self, key):
        with self.guard:
            return self.locks.setdefault(key, threading.Lock())

    def get(self, label, fetch, ttl=900):
        key = hashlib.sha256(label.encode()).hexdigest()
        with self.lock(key):
            cached = self.memory.get(key)
            if cached is None:
                try:
                    if self.bucket:
                        import boto3
                        obj = boto3.client('s3').get_object(Bucket=self.bucket, Key='market/'+key+'.json')
                        cached = json.loads(obj['Body'].read())
                    else:
                        cached = json.loads((self.directory/(key+'.json')).read_text())
                    if not isinstance(cached, dict) or not isinstance(cached.get('fetched_at'), str) or 'data' not in cached:
                        cached = None
                except Exception:
                    cached = None
            age = float('inf')
            if cached:
                try:
                    age = (self.clock()-datetime.fromisoformat(cached['fetched_at'])).total_seconds()
                except (ValueError, TypeError):
                    cached = None
                else:
                    self.memory[key] = cached
            if cached and 0 <= age < ttl:
                return {**cached, 'stale_cache': False}
            if self.failed_until.get(key, 0) > time.monotonic():
                if cached and 0 <= age < 7*86400:
                    return {**cached, 'stale_cache': True}
                raise DataUnavailable('資料來源暫時無法使用，請稍後重試')
            try:
                data = fetch()
                if data is None or data == []:
                    raise DataUnavailable('來源尚未提供資料')
                cached = {'data': data, 'fetched_at': self.clock().isoformat()}
                self.memory[key] = cached
                try:
                    encoded = json.dumps(cached, ensure_ascii=False).encode()
                    if self.bucket:
                        import boto3
                        boto3.client('s3').put_object(Bucket=self.bucket, Key='market/'+key+'.json', Body=encoded, ContentType='application/json')
                    else:
                        self.directory.mkdir(parents=True, exist_ok=True)
                        with tempfile.NamedTemporaryFile(dir=self.directory, delete=False) as stream:
                            stream.write(encoded)
                            temp = Path(stream.name)
                        temp.replace(self.directory/(key+'.json'))
                except Exception:
                    logging.warning('Market cache persistence unavailable; using request memory')
                return {**cached, 'stale_cache': False}
            except Exception as exc:
                self.failed_until[key] = time.monotonic()+60
                if cached and 0 <= age < 7*86400:
                    return {**cached, 'stale_cache': True}
                raise DataUnavailable('資料來源暫時無法使用，請稍後重試') from exc

def normalize_prices(rows, source, fetched_at, stale=False):
    if not isinstance(rows, list):
        raise DataUnavailable('價格來源格式錯誤')
    instruments = []
    for row in rows:
        code = str(row.get('Code') or row.get('SecuritiesCompanyCode') or '').strip()
        # This version supports four-digit common stocks, not ETFs/TDRs/warrants.
        if not re.fullmatch(r'[1-8]\d{3}', code):
            continue
        try:
            day = iso_date(row.get('Date'))
        except DataUnavailable:
            continue
        if day > datetime.now(TZ).date().isoformat():
            continue
        name = str(row.get('Name') or row.get('CompanyName') or '').strip()
        if not name:
            continue
        price = cents(row.get('ClosingPrice') if source == 'TWSE' else row.get('Close'))
        change = number(row.get('Change'))
        volume = number(row.get('TradeVolume') if source == 'TWSE' else row.get('TradingShares'))
        turnover = number(row.get('TradeValue') if source == 'TWSE' else row.get('TransactionAmount'))
        instruments.append({'symbol': code, 'name': name, 'exchange': source,
            'instrument_type': 'common_stock', 'trading_unit': 1000,
            'price': price, 'change': int(round(change*100)) if change is not None else None,
            'volume': int(volume) if volume is not None and volume >= 0 else None,
            'turnover': int(turnover) if turnover is not None and turnover >= 0 else None,
            'as_of': day, 'source': source, 'fetched_at': fetched_at, 'stale_cache': stale})
    if not instruments:
        raise DataUnavailable('來源沒有可支援的普通股資料')
    return instruments

class MarketService:
    def __init__(self, cache=None, fetcher=fetch_json, clock=utcnow):
        self.cache = cache or Cache(bucket=os.getenv('BAGLO_DATA_BUCKET'))
        self.fetcher, self.clock = fetcher, clock
        self.registry, self.index_until, self.status = {}, 0, []
        self.index_lock = threading.Lock()
        self._secret = None

    def index(self):
        with self.index_lock:
            if self.registry and time.monotonic() < self.index_until:
                return self.registry
            def load(entry):
                key, exchange = entry
                try:
                    def fetch_prices():
                        data = self.fetcher(SOURCES[key])
                        normalize_prices(data, exchange, self.clock().isoformat())
                        return data
                    cached = self.cache.get(key, fetch_prices)
                    rows = normalize_prices(cached['data'], exchange, cached['fetched_at'], cached['stale_cache'])
                    return rows, {'source': exchange, 'status': 'cached_stale' if cached['stale_cache'] else 'available'}
                except DataUnavailable:
                    return [], {'source': exchange, 'status': 'unavailable'}
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(load, [('twse_prices', 'TWSE'), ('tpex_prices', 'TPEx')]))
            registry, status = {}, []
            for rows, state in results:
                status.append(state)
                for item in rows:
                    prior = registry.get(item['symbol'])
                    if not prior or item['as_of'] > prior['as_of']:
                        registry[item['symbol']] = item
            if not registry:
                raise DataUnavailable('上市／上櫃資料暫時無法使用，仍可手動輸入既有標的限價')
            self.registry, self.status, self.index_until = registry, status, time.monotonic()+60
            return registry

    def resolve(self, symbol):
        if not isinstance(symbol, str) or not re.fullmatch(r'[1-8]\d{3}', symbol):
            raise DomainError('本版支援四碼上市櫃普通股，不含 ETF、TDR 與權證')
        item = self.index().get(symbol)
        if not item:
            raise DomainError('找不到可交易的普通股代號', 404)
        return item

    def order_instrument(self, symbol):
        item = dict(self.resolve(symbol))
        limits = self.price_limits(symbol)
        if limits['status'] != 'available':
            raise DomainError('尚未取得可信的漲跌停價格，請稍後重新取得報價再下單', 503)
        item['price_limits'] = limits
        return item

    def price_limits(self, symbol):
        try:
            key = self.fugle_key()
            if not key:
                raise DataUnavailable('未設定富果行情')
            cached = self.cache.get('fugle-limits:'+symbol, lambda: self.fetcher(
                'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/'+symbol,
                {'X-API-KEY': key}), ttl=60)
            data = cached['data']
            lower, upper = cents(data.get('limitDownPrice')), cents(data.get('limitUpPrice'))
            local = self.clock().astimezone(TZ).date()
            as_of = str(data.get('date', ''))
            age = (local - datetime.strptime(as_of, '%Y-%m-%d').date()).days
            if data.get('symbol') != symbol or not lower or not upper or lower > upper or cached['stale_cache'] or not 0 <= age <= 4:
                raise DataUnavailable('漲跌停資料不完整或過期')
            if local.weekday() < 5 and as_of != local.isoformat():
                raise DataUnavailable('尚未取得當日漲跌停資料')
            return {'status': 'available', 'lower': lower, 'upper': upper, 'reference': cents(data.get('referencePrice')),
                    'as_of': as_of, 'source': 'Fugle', 'historical_session': as_of != local.isoformat()}
        except Exception:
            return {'status': 'unavailable', 'reason': '無法確認漲跌停範圍；暫停新增委託，不以昨收推算'}

    def search(self, query='', low=None, high=None):
        rows = list(self.index().values())
        normalized = unicodedata.normalize('NFKC', query).strip().casefold().replace('臺', '台').replace('.two', '').replace('.tw', '')
        terms = normalized.split()
        if len(query) > 60:
            raise DomainError('搜尋字數過長')
        if terms:
            rows = [r for r in rows if all(t in (r['symbol']+' '+r['name']).casefold().replace('臺', '台') for t in terms)]
        if low is not None:
            rows = [r for r in rows if r['price'] is not None and r['price'] >= low]
        if high is not None:
            rows = [r for r in rows if r['price'] is not None and r['price'] <= high]
        if not terms:
            rows.sort(key=lambda r: (r['symbol'] not in UNIVERSE, r['symbol']))
        else:
            rows.sort(key=lambda r: (r['symbol'] != query.strip(), not r['symbol'].startswith(query.strip()), r['symbol']))
        return {'items': rows[:20], 'total': len(rows), 'sources': self.status,
                'price_kind': 'close', 'scope': '上市櫃普通股（不含 ETF、TDR、權證）'}

    def catalog(self):
        rows = sorted(self.index().values(), key=lambda row: row['symbol'])
        return {'items': rows, 'total': len(rows), 'sources': self.status,
                'price_kind': 'close', 'scope': '上市櫃普通股（不含 ETF、TDR、權證）'}

    def fugle_key(self):
        key = os.getenv('BAGLO_FUGLE_API_KEY', '')
        if key:
            return key
        arn = os.getenv('BAGLO_FUGLE_SECRET_ARN', '')
        if not arn:
            return ''
        if self._secret is None:
            import boto3
            raw = boto3.client('secretsmanager').get_secret_value(SecretId=arn)['SecretString']
            self._secret = json.loads(raw).get('FUGLE_API_KEY', '') if raw.lstrip().startswith('{') else raw
        return self._secret

    def quote(self, symbol, market_type='odd_lot'):
        if market_type not in ('odd_lot', 'board_lot'):
            raise DomainError('交易類別不正確')
        instrument = self.resolve(symbol)
        instrument = dict(instrument)
        instrument['price_limits'] = self.price_limits(symbol)
        fallback = {'price': instrument['price'], 'kind': 'close', 'source': instrument['source'],
                    'as_of': instrument['as_of'], 'fetched_at': instrument['fetched_at'],
                    'stale_cache': instrument['stale_cache'], 'is_realtime': False,
                    'market_type': 'daily_reference', 'requested_market_type': market_type,
                    'reason': '最近收盤參考價，並非盤中整股／零股即時報價'}
        try:
            key = self.fugle_key()
            if not key:
                return {'instrument': instrument, 'quote': fallback}
            url = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/'+symbol
            if market_type == 'odd_lot':
                url += '?type=oddlot'
            cached = self.cache.get('fugle:'+symbol+':'+market_type, lambda: self.fetcher(url, {'X-API-KEY': key}), ttl=30)
            data = cached['data']
            if data.get('symbol') != symbol or data.get('tradingHalt', {}).get('isHalted'):
                raise DataUnavailable('報價代號不符或標的暫停交易')
            trade = data.get('lastTrade', {})
            price = cents(trade.get('price'))
            timestamp = numeric(trade.get('time'))
            if price is None or timestamp is None:
                raise DataUnavailable('沒有可用成交報價')
            stamp = float(timestamp)
            stamp /= 1_000_000 if stamp > 1e14 else 1_000 if stamp > 1e11 else 1
            at = datetime.fromtimestamp(stamp, timezone.utc)
            age = (self.clock()-at).total_seconds()
            if age < -120:
                raise DataUnavailable('報價時間異常')
            local = self.clock().astimezone(TZ)
            session = local.weekday() < 5 and (9, 0) <= (local.hour, local.minute) <= (13, 30)
            live = session and age <= 120 and not cached['stale_cache'] and not data.get('isTrial') and not data.get('isClose')
            quote = {'price': price, 'kind': 'live' if live else 'last_trade', 'source': 'Fugle',
                     'as_of': at.isoformat(), 'fetched_at': cached['fetched_at'],
                     'stale_cache': cached['stale_cache'], 'is_realtime': live,
                     'market_type': market_type, 'requested_market_type': market_type,
                     'reason': '盤中成交報價' if live else '最近實際成交參考，非目前即時報價'}
            return {'instrument': instrument, 'quote': quote}
        except Exception:
            fallback['reason'] = '即時來源暫時不可用；使用最近收盤參考價，並非即時報價'
            return {'instrument': instrument, 'quote': fallback}

    def history(self, symbol, months=4, offset_months=0):
        if type(months) is not int or not 1 <= months <= 6 or type(offset_months) is not int or not 0 <= offset_months <= 114:
            raise DomainError("歷史範圍需為 1～6 個月，起點限最近 120 個月")
        instrument = self.resolve(symbol)
        current = self.clock().astimezone(TZ).date()
        bars, warnings = {}, []
        def load_month(offset):
            month_index = current.year*12 + current.month-1-offset
            year, month = divmod(month_index, 12)
            stamp = f'{year:04}{month+1:02}01'
            if instrument['exchange'] == 'TWSE':
                url = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?'+urlencode({'date': stamp, 'stockNo': symbol, 'response': 'json'})
            else:
                url = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?'+urlencode({'date': f'{year:04}/{month+1:02}/01', 'code': symbol, 'response': 'json'})
            def load():
                payload = self.fetcher(url)
                if instrument['exchange'] == 'TPEx':
                    if str(payload.get('stat', '')).lower() != 'ok':
                        raise DataUnavailable('上櫃歷史資料來源未就緒')
                    if payload.get('code') not in (None, symbol):
                        raise DataUnavailable('歷史資料股票代號不符')
                    table = next((t for t in payload.get('tables', []) if t.get('data') and '日 期' in t.get('fields', [])), None)
                    if not table:
                        raise DataUnavailable('上櫃歷史月份資料尚未提供')
                    mapping = {'日期': '日期', '開盤': '開盤價', '最高': '最高價', '最低': '最低價', '收盤': '收盤價', '成交張數': '成交股數'}
                    fields = [mapping.get(re.sub(r'\s+', '', f), re.sub(r'\s+', '', f)) for f in table['fields']]
                    volume_index = fields.index('成交股數')
                    rows = []
                    for original in table['data']:
                        row = list(original)
                        volume = numeric(row[volume_index])
                        row[volume_index] = str(volume*1000) if volume is not None else '--'
                        rows.append(row)
                    return {'stat': 'OK', 'fields': fields, 'data': rows}
                if payload.get('stat') != 'OK' or not payload.get('data'):
                    raise DataUnavailable('歷史月份資料尚未提供')
                return payload
            month_bars, month_warnings = {}, []
            try:
                current_stamp = f'{current.year:04}{current.month:02}01'
                ttl = 6*3600 if stamp == current_stamp else 30*86400
                cached = self.cache.get('history:'+('TPEx:' if instrument['exchange'] == 'TPEx' else '')+symbol+':'+stamp, load, ttl=ttl)
                data = cached['data']
                fields = data['fields']
                indexes = {name: fields.index(name) for name in ['日期', '開盤價', '最高價', '最低價', '收盤價', '成交股數']}
                for row in data['data']:
                    day = iso_date(row[indexes['日期']])
                    if day > current.isoformat():
                        continue
                    prices = {name: cents(row[indexes[column]]) for name, column in [('open', '開盤價'), ('high', '最高價'), ('low', '最低價'), ('close', '收盤價')]}
                    if any(v is None for v in prices.values()) or not prices['low'] <= prices['close'] <= prices['high']:
                        continue
                    volume = number(row[indexes['成交股數']])
                    month_bars[day] = {'date': day, **prices, 'volume': int(volume) if volume is not None else None}
                if cached['stale_cache']:
                    month_warnings.append(stamp+' 使用快取')
            except (DataUnavailable, KeyError, ValueError, IndexError):
                month_warnings.append(stamp+' 暫無資料')
            return month_bars, month_warnings
        # Monthly official endpoints are independent. A small bounded pool avoids
        # making the chart wait for every network round trip in sequence.
        with ThreadPoolExecutor(max_workers=min(3, months)) as pool:
            results = list(pool.map(load_month, range(offset_months, offset_months+months)))
        for month_bars, month_warnings in results:
            bars.update(month_bars)
            warnings.extend(month_warnings)
        ordered = sorted(bars.values(), key=lambda b: b['date'])
        def sma(count):
            return round(sum(b['close'] for b in ordered[-count:])/count) if len(ordered) >= count else None
        return {'bars': ordered, 'source': instrument['exchange'], 'status': 'available' if ordered else 'unavailable',
                'adjusted': False, 'sma20': sma(20), 'sma60': sma(60), 'warnings': warnings,
                'as_of': ordered[-1]['date'] if ordered else None,
                'note': '官方未還原日線；除權息可能造成價格跳空，不能直接當成策略報酬'}

    def fundamentals(self, symbol):
        instrument = self.resolve(symbol)
        prefix = 'twse' if instrument['exchange'] == 'TWSE' else 'tpex'
        def load(part):
            try:
                def fetch_part():
                    data = self.fetcher(SOURCES[prefix+'_'+part])
                    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
                        raise DataUnavailable('基本面來源格式錯誤')
                    return data
                cached = self.cache.get(prefix+'_'+part, fetch_part, ttl=6*3600)
                for row in cached['data']:
                    code = str(row.get('Code') or row.get('SecuritiesCompanyCode') or row.get('公司代號') or '').strip()
                    if code == symbol:
                        return row, cached
            except DataUnavailable:
                pass
            return None, None
        with ThreadPoolExecutor(max_workers=2) as pool:
            revenue_result, valuation_result = list(pool.map(load, ['revenue', 'valuation']))
        revenue, rc = revenue_result
        valuation, vc = valuation_result
        result = {'source': instrument['exchange'], 'revenue': None, 'valuation': None}
        if revenue:
            result['revenue'] = {'period': revenue.get('資料年月'),
                'yoy_percent': number(revenue.get('營業收入-去年同月增減(%)')),
                'mom_percent': number(revenue.get('營業收入-上月比較增減(%)')),
                'report_date': iso_date(revenue.get('出表日期')), 'fetched_at': rc['fetched_at'], 'stale_cache': rc['stale_cache']}
        if valuation:
            result['valuation'] = {'pe': number(valuation.get('PEratio') or valuation.get('PriceEarningRatio')),
                'pb': number(valuation.get('PBratio') or valuation.get('PriceBookRatio')),
                'dividend_yield_percent': number(valuation.get('DividendYield') or valuation.get('YieldRatio')),
                'as_of': iso_date(valuation.get('Date')), 'fetched_at': vc['fetched_at'], 'stale_cache': vc['stale_cache']}
        result['status'] = 'available' if result['revenue'] or result['valuation'] else 'unavailable'
        return result

    def ownership(self, symbol):
        instrument = self.resolve(symbol)
        try:
            if instrument['exchange'] == 'TWSE':
                url = 'https://www.twse.com.tw/rwd/zh/fund/T86?'+urlencode({'date': instrument['as_of'].replace('-', ''), 'selectType': 'ALLBUT0999', 'response': 'json'})
                def fetch():
                    payload = self.fetcher(url)
                    if payload.get('stat') != 'OK' or not payload.get('data'):
                        raise DataUnavailable('法人資料尚未公布')
                    return payload
                cached = self.cache.get('twse-institutions:'+instrument['as_of'], fetch, ttl=6*3600)
                payload = cached['data']
                row = next((dict(zip(payload['fields'], row)) for row in payload['data'] if str(row[0]).strip() == symbol), None)
                if not row:
                    raise DataUnavailable('找不到法人資料')
                def by_prefix(prefix):
                    return next((number(v) for k, v in row.items() if k.startswith(prefix)), None)
                foreign = by_prefix('外陸資買賣超股數')
                trust = by_prefix('投信買賣超股數')
                dealer = row.get('自營商買賣超股數')
                total = row.get('三大法人買賣超股數')
                day = instrument['as_of']
                dealer, total = number(dealer), number(total)
            else:
                cached = self.cache.get('tpex_institutions', lambda: self.fetcher(SOURCES['tpex_institutions']), ttl=6*3600)
                row = next((r for r in cached['data'] if str(r.get('SecuritiesCompanyCode', '')).strip() == symbol), None)
                if not row:
                    raise DataUnavailable('找不到法人資料')
                clean = {re.sub(r'\s+', '', k): v for k, v in row.items()}
                foreign = number(clean.get('ForeignInvestorsincludeMainlandAreaInvestors(ForeignDealersexcluded)-Difference'))
                trust = number(clean.get('SecuritiesInvestmentTrustCompanies-Difference'))
                dealer, total = number(clean.get('Dealers-Difference')), number(clean.get('TotalDifference'))
                day = iso_date(row.get('Date'))
            return {'status': 'available', 'source': instrument['exchange'], 'as_of': day,
                    'foreign_net_shares': foreign, 'trust_net_shares': trust, 'dealer_net_shares': dealer,
                    'total_net_shares': total, 'unit': 'shares', 'stale_cache': cached['stale_cache'],
                    'fetched_at': cached['fetched_at'], 'note': '外資欄為外陸資（不含外資自營商）；總計依官方口徑，未必等於畫面三欄加總'}
        except (DataUnavailable, ValueError, KeyError, IndexError):
            return {'status': 'unavailable', 'source': instrument['exchange'], 'reason': '法人資料尚未公布或來源暫時無法使用'}
