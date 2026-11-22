"""Reproducible fixed-rule research. Never calls a model or changes the paper ledger."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date,datetime,timedelta,timezone
from decimal import Decimal,ROUND_CEILING,ROUND_FLOOR
from pathlib import Path
from statistics import mean,stdev
import hashlib,json,math,os,re,uuid
from zoneinfo import ZoneInfo
from .domain import DomainError,stock_price_tick

_pool=ThreadPoolExecutor(max_workers=2)

def validate(body):
    required={'symbol','strategy','start_date','end_date','initial_cash','fast','slow','lookback','slippage_bps','market_type'}
    if set(body)!=required:raise DomainError('回測欄位不正確')
    if body['strategy'] not in ('sma','breakout','buy_hold') or body['market_type'] not in ('odd_lot','board_lot'):raise DomainError('不支援的策略或交易類別')
    for key,lo,hi in [('initial_cash',100000,1000000000),('fast',2,120),('slow',3,250),('lookback',2,120),('slippage_bps',0,100)]:
        if type(body[key]) is not int or not lo<=body[key]<=hi:raise DomainError(f'{key} 超出有效範圍')
    if body['strategy']=='sma' and body['fast']>=body['slow']:raise DomainError('短均線須小於長均線')
    try:start,end=date.fromisoformat(body['start_date']),date.fromisoformat(body['end_date'])
    except (TypeError,ValueError):raise DomainError('日期格式須為 YYYY-MM-DD')
    today=datetime.now(ZoneInfo('Asia/Taipei')).date()
    if end<start or end>today or (end-start).days>1096 or (today-start).days>2923:raise DomainError('請選擇最近八年內、不超過三年的歷史區間，結束日不可為未來')
    return start,end

def fee(gross):return max(2000,(gross*1425+500000)//1000000)
def slipped(price,bps,buy,day):
    raw=Decimal(price)*(Decimal(10000+bps if buy else 10000-bps)/10000)
    tick=stock_price_tick(int(raw),date.fromisoformat(day))
    return max(tick,int((raw/tick).to_integral_value(rounding=ROUND_CEILING if buy else ROUND_FLOOR))*tick)

def simulate(bars,request,start=None,end=None,strategy=None):
    start=start or request['start_date'];end=end or request['end_date'];strategy=strategy or request['strategy']
    cash=request['initial_cash'];quantity=0;entry_cost=0;curve=[];trades=[];outcomes=[];fees=taxes=slippage=0;skipped=0
    fast,slow,lookback=request['fast'],request['slow'],request['lookback']
    selected=[i for i,b in enumerate(bars) if start<=b['date']<=end]
    if len(selected)<2:raise DomainError('此區間少於兩個交易日，無法回測')
    for i in selected:
        bar=bars[i];signal=bars[i-1] if i else None;buy=sell=False
        if strategy=='buy_hold':buy=not trades and quantity==0
        elif signal:
            closes=[b['close'] for b in bars[max(0,i-slow):i]]
            if strategy=='sma' and len(closes)>=slow:
                short=mean(closes[-fast:]);long=mean(closes)
                buy=quantity==0 and short>long;sell=quantity>0 and short<long
            elif strategy=='breakout' and i>=lookback+1:
                prior_high=max(b['high'] for b in bars[i-lookback-1:i-1])
                buy=quantity==0 and signal['close']>prior_high
                sell=quantity>0 and signal['close']<mean([b['close'] for b in bars[i-lookback:i]])
        if (buy or sell) and (not bar.get('volume') or bar['high']==bar['low']):
            skipped+=1;buy=sell=False
        if buy:
            price=slipped(bar['open'],request['slippage_bps'],True,bar['date'])
            unit=1000 if request['market_type']=='board_lot' else 1
            # Liquidity sizing uses only prior-day volume, never the fill-day final volume.
            volume_cap=(signal.get('volume') or 0)//100 if signal else (1000 if unit==1000 else 999)
            count=min(cash//price,volume_cap,999 if unit==1 else 499000)//unit*unit
            while count>0 and count*price+fee(count*price)>cash:count-=unit
            if count:
                gross=count*price;cost=fee(gross);cash-=gross+cost;quantity=count;entry_cost=gross+cost;fees+=cost;slippage+=count*(price-bar['open'])
                trades.append({'date':bar['date'],'signal_date':signal['date'] if signal and strategy!='buy_hold' else None,'side':'buy','quantity':count,'price':price,'fee':cost,'tax':0,'slippage':count*(price-bar['open'])})
        elif sell and quantity:
            price=slipped(bar['open'],request['slippage_bps'],False,bar['date']);gross=quantity*price;cost=fee(gross);tax=(gross*3+500)//1000
            cash+=gross-cost-tax;fees+=cost;taxes+=tax;slippage+=quantity*(bar['open']-price);outcomes.append(gross-cost-tax-entry_cost)
            trades.append({'date':bar['date'],'signal_date':signal['date'],'side':'sell','quantity':quantity,'price':price,'fee':cost,'tax':tax,'slippage':quantity*(bar['open']-price)})
            quantity=0;entry_cost=0
        curve.append({'date':bar['date'],'equity':cash+quantity*bar['close'],'cash':cash,'quantity':quantity})
    previous=request['initial_cash'];peak=previous;returns=[];drawdown=0
    for point in curve:
        returns.append(point['equity']/previous-1 if previous else 0);previous=point['equity'];peak=max(peak,previous);drawdown=max(drawdown,(peak-previous)/peak if peak else 0)
    final=curve[-1]['equity'];elapsed=(date.fromisoformat(curve[-1]['date'])-date.fromisoformat(curve[0]['date'])).days
    deviation=stdev(returns) if len(returns)>1 else 0
    metrics={'total_return':(final/request['initial_cash']-1)*100,'annualized_return':((final/request['initial_cash'])**(365/elapsed)-1)*100 if elapsed>0 and final>0 else None,
             'max_drawdown':drawdown*100,'sharpe':mean(returns)/deviation*math.sqrt(252) if deviation else None,
             'trade_count':len(trades),'completed_trades':len(outcomes),'win_rate':sum(v>0 for v in outcomes)/len(outcomes)*100 if outcomes else None,
             'fees':fees,'taxes':taxes,'slippage':slippage,'turnover':sum(t['quantity']*t['price'] for t in trades)/request['initial_cash'],
             'final_equity':final,'final_cash':cash,'final_quantity':quantity,'skipped_days':skipped}
    return {'metrics':metrics,'curve':curve,'trades':trades,'start_date':curve[0]['date'],'end_date':curve[-1]['date']}

def path_key(account,job_id):
    if not re.fullmatch(r'[0-9a-f-]{36}',job_id):raise DomainError('無效回測編號',404)
    return 'market/backtests/'+hashlib.sha256(account.encode()).hexdigest()[:24]+'/'+job_id+'.json'

def write(account,job):
    key=path_key(account,job['id']);body=json.dumps(job,ensure_ascii=False,allow_nan=False).encode()
    if os.getenv('BAGLO_DATA_BUCKET'):
        import boto3
        boto3.client('s3').put_object(Bucket=os.environ['BAGLO_DATA_BUCKET'],Key=key,Body=body,ContentType='application/json')
    else:
        path=Path('data')/key;path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_bytes(body);temp.replace(path)

def read(account,job_id):
    key=path_key(account,job_id)
    try:
        if os.getenv('BAGLO_DATA_BUCKET'):
            import boto3
            body=boto3.client('s3').get_object(Bucket=os.environ['BAGLO_DATA_BUCKET'],Key=key)['Body'].read()
        else:body=(Path('data')/key).read_bytes()
        job=json.loads(body)
    except Exception:raise DomainError('找不到此帳戶的回測紀錄',404)
    if job['status'] in ('queued','running') and (datetime.now(timezone.utc)-datetime.fromisoformat(job['created_at'])).total_seconds()>900:
        job.update(status='failed',error='回測逾時，請縮短區間或重新執行')
    return job

def start(account,body,markets):
    validate(body);markets.resolve(body['symbol'])
    job={'id':str(uuid.uuid4()),'status':'queued','request':body,'created_at':datetime.now(timezone.utc).isoformat()}
    write(account,job)
    try:
        if os.getenv('BAGLO_AI_WORKER'):
            import boto3
            boto3.client('lambda').invoke(FunctionName=os.environ['BAGLO_AI_WORKER'],InvocationType='Event',Payload=json.dumps({'type':'backtest','account':account,'job_id':job['id']}).encode())
        else:_pool.submit(run,account,job['id'],markets)
    except Exception:
        job.update(status='failed',error='無法排入回測工作');write(account,job)
    return {'id':job['id'],'status':job['status']}

def run(account,job_id,markets):
    job=read(account,job_id)
    if job['status']!='queued':return
    job['status']='running';write(account,job)
    try:
        request=job['request'];begin,finish=validate(request)
        warmup=begin-timedelta(days=max(request['slow'],request['lookback'])*2+30)
        today=datetime.now(ZoneInfo('Asia/Taipei')).date();month=lambda d:d.year*12+d.month-1
        first=max(0,month(today)-month(finish));last=min(119,month(today)-month(warmup))
        collected={};warnings=[]
        for offset in range(first,last+1,6):
            at=min(offset,114);count=min(6,120-at,last-at+1)
            data=markets.history(request['symbol'],months=count,offset_months=at)
            for bar in data['bars']:
                if warmup.isoformat()<=bar['date']<=finish.isoformat():collected[bar['date']]=bar
            warnings.extend(data['warnings'])
        bars=sorted(collected.values(),key=lambda b:b['date'])
        if not bars:raise DomainError('未取得可用歷史資料')
        required=0 if request['strategy']=='buy_hold' else request['slow'] if request['strategy']=='sma' else request['lookback']+1
        if sum(b['date']<request['start_date'] for b in bars)<required:raise DomainError('起始日前暖機資料不足，請縮短均線參數或延後起日')
        if any(not (0<b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']) for b in bars):raise DomainError('日線開高低收資料不一致')
        full=simulate(bars,request);benchmark=simulate(bars,request,strategy='buy_hold')
        dates=[b['date'] for b in bars if request['start_date']<=b['date']<=request['end_date']]
        if len(dates)<20:raise DomainError('至少需要 20 個交易日；短區間不足以提供樣本切分')
        split=max(2,min(len(dates)-2,int(len(dates)*.7)))
        development=simulate(bars,request,end=dates[split-1]);holdout=simulate(bars,request,start=dates[split])
        holdout_benchmark=simulate(bars,request,start=dates[split],strategy='buy_hold')
        serialized=json.dumps(bars,sort_keys=True).encode()
        job.update(status='completed',result={'strategy':full,'benchmark':benchmark,'development':development,'holdout':holdout,'holdout_benchmark':holdout_benchmark,
                   'excess_return':full['metrics']['total_return']-benchmark['metrics']['total_return'],'warnings':sorted(set(warnings)),
                   'data_sha256':hashlib.sha256(serialized).hexdigest(),'bar_count':len(bars),'bars':bars,
                   'notes':['訊號只使用前一交易日收盤前可取得資料，於下一交易日開盤加滑價模擬。','同一筆虛擬資金、整數股、零股每單最多 999 股；部位至多為前日成交量 1%。','固定規則回測，不使用今日 AI 回填歷史建議；70/30 分段各自以初始資金啟動，參數不變。','日線未還原權息，未建模歷史漲跌停基準、委託簿、交割或暫停交易；無量或單一價格日保守跳過。','期末持倉以最後收盤估值，不假設強制賣出；買入持有基準使用相同費稅滑價。','僅能查詢目前仍在登錄表的股票，可能有存活者偏差。', 'Sharpe 以零無風險利率、252 日年化估計。樣本少、反覆調參與缺漏資料均可能讓績效失真。']})
    except Exception as exc:job.update(status='failed',error=str(exc) if isinstance(exc,DomainError) else '歷史資料或回測計算失敗，請縮短區間後重試')
    job['completed_at']=datetime.now(timezone.utc).isoformat();write(account,job)
