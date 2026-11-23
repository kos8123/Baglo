"""OpenAPI 3.0 contract for the Lambda/local HTTP API."""
def document():
    ref=lambda name:{'$ref':'#/components/schemas/'+name}
    integer=lambda description,min=0:{'type':'integer','minimum':min,'description':description}
    order_fields={'symbol':{'type':'string','pattern':'^[1-8][0-9]{3}$'},'side':{'type':'string','enum':['buy','sell']},'quantity':integer('總股數，不是張數；整股須為 1000 倍數，零股 1～999',1),'market_type':{'type':'string','enum':['board_lot','odd_lot']},'limit_price':integer('每股價格，單位為新臺幣分；須符合升降單位與漲跌停',1)}
    schemas={
        'Error':{'type':'object','properties':{'error':{'type':'string'},'retryable':{'type':'boolean'}}},
        'OrderInput':{'type':'object','additionalProperties':False,'required':['symbol','side','quantity','limit_price'],'properties':order_fields},
        'Order':{'type':'object','properties':{**order_fields,'id':{'type':'string'},'name':{'type':'string'},'status':{'type':'string','enum':['pending','filled','cancelled']},'reserved':integer('保留資金，單位分'),'source':{'type':'string'},'created_at':{'type':'string','format':'date-time'},'fee':integer('成交手續費，分'),'tax':integer('成交稅，分')}},
        'Account':{'type':'object','properties':{'cash':integer('現金，分'),'initial_cash':integer('初始本金，分'),'positions':{'type':'object','additionalProperties':{'type':'integer'}},'orders':{'type':'array','items':ref('Order')},'watchlist':{'type':'array','items':{'type':'string'}}}},
        'AiSettings':{'type':'object','additionalProperties':False,'required':['enabled','symbols','budget','min_confidence'],'properties':{'enabled':{'type':'boolean'},'symbols':{'type':'array','items':{'type':'string'},'minItems':1},'budget':{'type':'integer','minimum':10000,'maximum':30000000,'description':'每筆 AI 模擬預算，單位分'},'min_confidence':{'type':'number','minimum':.5,'maximum':1}}},
        'Bar':{'type':'object','properties':{'date':{'type':'string','format':'date'},**{k:integer('價格，分') for k in ['open','high','low','close']},'volume':{'type':'integer','nullable':True}}},
        'History':{'type':'object','properties':{'bars':{'type':'array','items':ref('Bar')},'source':{'type':'string'},'warnings':{'type':'array','items':{'type':'string'}}}},
    }
    def op(summary,method='get',schema=None,public=False,params=None,body=None,code='200'):
        responses={code:{'description':'成功','content':{'application/json':{'schema':schema or {'type':'object'}}}}}
        for error_code,description in [('400','格式不正確'),('401','未登入'),('409','衝突或尚未啟用'),('422','數量／限價／資金／持倉驗證失敗'),('503','資料或服務暫不可用')]:
            responses[error_code]={'description':description,'content':{'application/json':{'schema':ref('Error')}}}
        result={'summary':summary,'security':[] if public else [{'BearerAuth':[]}],'responses':responses}
        if params:result['parameters']=params
        if body:result['requestBody']={'required':True,'content':{'application/json':{'schema':body}}}
        return result
    param=lambda name,typ='string',where='query',required=False,**props:{'name':name,'in':where,'required':required,'schema':{'type':typ,**props}}
    symbol=[param('symbol',where='path',required=True)]
    paths={
      '/api/health':{'get':op('健康檢查（不表示券商或 AI 已啟用）',public=True)},
      '/api/config':{'get':op('公開環境與登入設定，不含秘密',public=True)},
      '/api/openapi.json':{'get':op('OpenAPI 文件',public=True)},
      '/api/account':{'get':op('取得自己的資金、持倉與委託',schema=ref('Account'))},
      '/api/portfolio':{'get':op('移動平均成本與參考市值；各筆標示價格時間')},
      '/api/instruments':{'get':op('上市櫃普通股代號、名稱與收盤價格搜尋',public=True,params=[param('q'),param('min_price','number',minimum=0),param('max_price','number',minimum=0)])},
      '/api/instruments/export':{'get':op('排程快取使用的公開上市櫃普通股清單',public=True)},
      '/api/market/{symbol}':{'get':op('整股／零股參考行情與漲跌停資料',public=True,params=symbol+[param('market_type',enum=['board_lot','odd_lot'])])},
      '/api/history/{symbol}':{'get':op('官方未還原日線，分頁查詢',schema=ref('History'),public=True,params=symbol+[param('months','integer',minimum=1,maximum=6,default=4),param('offset','integer',minimum=0,maximum=114,default=0)])},
      '/api/research/{symbol}':{'get':op('營收、估值與法人資料',params=symbol)},
      '/api/watchlist':{'get':op('取得帳戶自選股與最近收盤參考'),'put':op('儲存帳戶自選股，最多30檔')},
      '/api/watchlist/health':{'get':op('取得已保存的 AI 自選股健康摘要'),'post':op('依當日清單及持倉建立或沿用 AI 健康摘要')},
      '/api/orders':{'post':op('建立純模擬限價委託；重試須沿用同一編號',schema=ref('Order'),params=[param('Idempotency-Key',where='header',required=True,minLength=8,maxLength=100)],body=ref('OrderInput'))},
      '/api/orders/{id}/cancel':{'post':op('取消待成交委託，重播不重複扣款',schema=ref('Order'),params=[param('id',where='path',required=True)])},
      '/api/orders/{id}/demo-fill':{'post':op('僅本機沙盒：依限價示範帳務成交，非市場撮合',schema=ref('Order'),params=[param('id',where='path',required=True)])},
      '/api/analysis':{'get':op('舊版分析相容端點；新版請用 /api/ai')},
      '/api/backtests':{'post':op('建立非同步固定策略回測，不改動模擬帳本',code='202',body={'type':'object','required':['symbol','strategy','start_date','end_date','initial_cash','fast','slow','lookback','slippage_bps','market_type'],'properties':{'symbol':{'type':'string'},'strategy':{'type':'string','enum':['sma','breakout','buy_hold']},'start_date':{'type':'string','format':'date'},'end_date':{'type':'string','format':'date'},'initial_cash':integer('本金，分',100000),'fast':{'type':'integer'},'slow':{'type':'integer'},'lookback':{'type':'integer'},'slippage_bps':{'type':'integer'},'market_type':{'type':'string','enum':['odd_lot','board_lot']}}})},
      '/api/backtests/{id}':{'get':op('取得自己帳戶的回測狀態與結果',params=[param('id',where='path',required=True)])},
      '/api/ai':{'get':op('AI 設定、工作狀態與已保存的建議')},
      '/api/ai/test':{'post':op('實際模型連線與結構化輸出測試，會消耗少量模型額度，不產生委託')},
      '/api/ai/automation':{'get':op('取得本帳戶最近 AI 策略回測選股結果；不回傳原始私有審計輸入')},
      '/api/ai/automation/research':{'post':op('以已儲存候選池非同步產生 AI 策略並回測選股，每檔可能消耗一次模型額度',code='202')},
      '/api/ai/automation/settings':{'put':op('儲存最多20檔候選池，切換為先回測選股再模擬委託的每日模式',schema=ref('AiSettings'),body=ref('AiSettings'))},
      '/api/ai/settings':{'put':op('儲存帳戶 AI 純模擬設定；啟用需另有模型金鑰',schema=ref('AiSettings'),body=ref('AiSettings'))},
      '/api/ai/jobs':{'post':op('非同步建立三面向 AI 分析，可能產生模型 API 費用',body={'type':'object','required':['symbol'],'properties':{'symbol':{'type':'string'}}},code='202')},
      '/api/ai/jobs/{id}/execute':{'post':op('將今日 AI 建議轉成模擬委託；需開市、可信即時報價與風控',schema=ref('Order'),params=[param('id',where='path',required=True)])},
    }
    return {'openapi':'3.0.3','info':{'title':'Baglo Paper Trading API','version':'0.3.0','description':'僅模擬交易。價格、費用與預算均以新臺幣分傳遞；股數一律為股。雲端需 Cognito access token；本機自動注入沙盒身分。'},'servers':[{'url':'/'}],'components':{'securitySchemes':{'BearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT'}},'schemas':schemas},'paths':paths}
