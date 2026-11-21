'use strict';
const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('zh-TW', {style:'currency',currency:'TWD',maximumFractionDigits:2}).format(cents/100);
let config, account, pendingRequest, apiBase='';
const quantityDraft={odd_lot:10,board_lot:1};
const statusNames = {pending:'待成交',filled:'已成交',cancelled:'已取消'};
function showError(error) { $('error').textContent=error.message; $('error').hidden=false;toast(error.message,true); }
function view(name) { for(const section of document.querySelectorAll('.view')) section.hidden=section.id!==name; for(const nav of document.querySelectorAll('.nav')) nav.classList.toggle('active',nav.dataset.view===name); }
async function api(path, options={}) {
  const headers={'Content-Type':'application/json',...options.headers};
  const token=sessionStorage.getItem('baglo_token');
  if(token) headers.Authorization='Bearer '+token;
  let response;try{response=await fetch(apiBase+'/api'+path,{...options,headers,signal:options.signal||AbortSignal.timeout(30000)});}catch(error){throw new Error(['AbortError','TimeoutError'].includes(error.name)?'連線逾時，請稍後重試；不必重複建立委託。':'無法連線，請確認網路或稍後重試。');}
  let data; try { data=await response.json(); } catch { throw new Error('服務未回傳有效資料，請稍後再試。'); }
  if(!response.ok) { if(response.status===401){sessionStorage.removeItem('baglo_token');ready=false;$('login').hidden=false;$('logout').hidden=true;$('submit-order').disabled=true;} throw new Error(data.error||'服務暫時無法使用'); }
  return data;
}
async function login() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const base64url=buffer=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const verifier=base64url(bytes), state=crypto.randomUUID();
  sessionStorage.setItem('baglo_verifier',verifier); sessionStorage.setItem('baglo_oauth_state',state);
  const challenge=base64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const url=new URL(config.auth_domain+'/oauth2/authorize');
  url.search=new URLSearchParams({client_id:config.client_id,response_type:'code',scope:'openid baglo-api/access',redirect_uri:location.origin+'/',state,code_challenge_method:'S256',code_challenge:challenge});
  location.assign(url);
}
async function finishLogin() {
  const query=new URLSearchParams(location.search);
  if(query.has('error')) { history.replaceState(null,'','/'); throw new Error('登入未完成，請重新登入。'); }
  if(!query.has('code')) return;
  const expected=sessionStorage.getItem('baglo_oauth_state'), verifier=sessionStorage.getItem('baglo_verifier');
  history.replaceState(null,'','/');
  sessionStorage.removeItem('baglo_oauth_state'); sessionStorage.removeItem('baglo_verifier');
  if(!expected||expected!==query.get('state')||!verifier) throw new Error('登入驗證已失效，請重試。');
  const response=await fetch(config.auth_domain+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.client_id,code:query.get('code'),redirect_uri:location.origin+'/',code_verifier:verifier})});
  const data=await response.json();
  if(!response.ok||!data.access_token) throw new Error('無法完成登入，請重試。');
  sessionStorage.setItem('baglo_token',data.access_token);
}
function render() {
  $('cash').textContent=money(account.cash);
  const reserved=account.orders.filter(o=>o.status==='pending'&&o.side==='buy').reduce((a,o)=>a+o.reserved,0);
  $('available').textContent=money(account.cash-reserved);
  const positions=Object.entries(account.positions).filter(([,q])=>q>0);
  $('holdings').textContent=positions.length.toString().padStart(2,'0');
  $('positions').replaceChildren();
  if(!positions.length) { $('positions').className='empty'; $('positions').textContent='尚無持倉。先建立一筆模擬委託。'; }
  else { $('positions').className=''; const ul=document.createElement('ul'); for(const [symbol,quantity] of positions) { const li=document.createElement('li'); const label=document.createElement('span'), value=document.createElement('strong'); label.textContent=symbol+' '+symbolName(symbol);value.textContent=formatHolding(quantity);li.append(label,value);ul.append(li); } $('positions').append(ul); }
  $('orders').replaceChildren(); $('no-orders').hidden=account.orders.length>0;
  for(const order of [...account.orders].reverse()) {
    const tr=document.createElement('tr');
    const market=order.market_type||(order.quantity%1000===0?'board_lot':order.quantity<1000?'odd_lot':'legacy');
    const quantityText=market==='board_lot'?(order.quantity/1000)+' 張（'+order.quantity.toLocaleString('zh-TW')+' 股）':order.quantity.toLocaleString('zh-TW')+' 股';
    for(const value of [order.symbol+' '+(order.name||symbolName(order.symbol)),order.side==='buy'?'買入':'賣出',market==='board_lot'?'整股':market==='odd_lot'?'零股':'舊制',quantityText,money(order.limit_price)]) { const td=document.createElement('td'); td.textContent=value; tr.append(td); }
    const status=document.createElement('td'), badge=document.createElement('span'); badge.className='status '+order.status;badge.textContent=statusNames[order.status];status.append(badge);tr.append(status);
    const actions=document.createElement('td');
    if(order.status==='pending') {
      for(const [name,action] of [['取消','cancel'],...(config.demo?[['沙盒成交','demo-fill']]:[])]) {
        const button=document.createElement('button');button.textContent=name;
        button.onclick=async()=>{ button.disabled=true;try{await api('/orders/'+encodeURIComponent(order.id)+'/'+action,{method:'POST',body:'{}'});await refresh();toast(action==='cancel'?'模擬委託已取消':'已完成本機沙盒成交，並非實際市場成交');}catch(e){showError(e);button.disabled=false;} };
        actions.append(button);
      }
    }
    tr.append(actions);$('orders').append(tr);
  }
  updateEstimate();
}
const instrumentMap=new Map();
let ready=false, quoteData=null, priceDirty=false, selectionSerial=0, quoteSerial=0;
let searchItems=[], searchActive=-1, searchSerial=0, searchTimer, toastTimer, searchDirty=false;
const watchSymbols=[];
function toast(message,isError=false) { $('toast').classList.toggle('toast-error',isError);$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},4500); }
function dateLabel(value) { if(!value)return '日期未提供';if(value.length===10)return value;const d=new Date(value);return Number.isNaN(d.valueOf())?value:new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'}).format(d); }
function referenceLabel(q) { return q.kind==='live'?(q.market_type==='odd_lot'?'零股現價':'整股現價'):q.kind==='last_trade'?'最近成交參考價':'最近收盤參考價'; }
function symbolName(symbol) { return instrumentMap.get(symbol)?.name||account?.orders.find(o=>o.symbol===symbol&&o.name)?.name||symbol; }
function tickForPrice(value) { for(const band of config?.price_ticks||[{below:1000,tick:1},{below:5000,tick:5},{below:10000,tick:10},{below:50000,tick:50},{below:100000,tick:100},{below:null,tick:500}]) if(band.below===null||value<band.below)return band.tick; }
function setPriceDirty() { priceDirty=true;updatePriceOrigin();updateEstimate(); }
function updatePriceOrigin() { $('price-origin').textContent=priceDirty?'自訂限價 · 更新報價不會覆蓋':quoteData?.price?'已帶入'+referenceLabel(quoteData):'目前沒有價格，請手動輸入'; }
function useQuote() { if(!quoteData?.price)return;$('price').value=(quoteData.price/100).toFixed(2);priceDirty=false;updatePriceOrigin();updateEstimate(); }
function stepPrice(direction) { let current=Math.round(Number($('price').value)*100);if(!Number.isFinite(current)||current<=0)current=quoteData?.price||1;const step=tickForPrice(direction<0?Math.max(1,current-1):current);const next=direction>0?(Math.floor(current/step)+1)*step:(Math.ceil(current/step)-1)*step;$('price').value=(Math.min(10000000,Math.max(1,next))/100).toFixed(2);setPriceDirty(); }
$('price').addEventListener('input',setPriceDirty);
$('price').addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();stepPrice(event.key==='ArrowUp'?1:-1);}});
$('price-minus').onclick=()=>stepPrice(-1);$('price-plus').onclick=()=>stepPrice(1);$('use-quote').onclick=useQuote;
function selectInstrument(symbol) {
  const item=instrumentMap.get(symbol);if(!item)return;
  if(!Array.from($('symbol').options).some(o=>o.value===symbol)){const o=document.createElement('option');o.value=symbol;o.textContent=symbol+' '+item.name;$('symbol').append(o);}
  $('symbol').value=symbol;$('stock-search').value=symbol+' '+item.name;searchDirty=false;
  $('selected-name').textContent='目前下單 '+symbol+' '+item.name;$('search-status').textContent='可用代號、名稱或價格區間，重新選擇標的。';$('selected-exchange').textContent=item.exchange==='TPEx'?'上櫃':'上市';$('instrument-exchange').textContent=item.exchange==='TPEx'?'TAIPEI EXCHANGE':'TAIWAN STOCK EXCHANGE';
  $('chart-symbol').textContent=symbol+' '+item.name;$('chart-monogram').textContent=item.name.slice(0,1);$('analysis-symbol').textContent=symbol+' '+item.name;
  if(!watchSymbols.includes(symbol)){watchSymbols.unshift(symbol);watchSymbols.splice(8);}
  renderWatchlist();hideSearch();priceDirty=false;quoteData=null;$('price').value='';updatePriceOrigin();updateEstimate();
  if(ready){const serial=++selectionSerial;chartEmpty('正在取得官方日線…');$('chart-status').textContent='正在載入 '+symbol+' 歷史資料';for(const id of ['facet-technical','facet-fundamental','facet-ownership'])$(id).textContent='載入中';for(const id of ['technical-detail','fundamental-detail','ownership-detail'])$(id).textContent='正在取得官方資料…';loadQuote().then(()=>{if(serial!==selectionSerial)return;loadHistory(symbol,serial);loadResearch(symbol,serial);hydrateWatchlist();});}
}
function renderWatchlist() {
  $('watchlist').replaceChildren();
  for(const symbol of watchSymbols) {
    const item=instrumentMap.get(symbol);if(!item)continue;
    const button=document.createElement('button');button.type='button';button.className='watch-item';button.dataset.symbol=symbol;
    const selected=$('symbol').value===symbol;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    button.setAttribute('aria-label','選擇 '+symbol+' '+item.name);
    const monogram=document.createElement('span');monogram.className='stock-monogram';monogram.textContent=item.name.slice(0,1);
    const label=document.createElement('span');label.className='stock-label';label.textContent=item.name;
    const code=document.createElement('small');code.textContent=symbol;label.append(code);
    const value=document.createElement('span');value.className='watch-arrow';value.textContent=item.price?money(item.price):'↗';
    value.title=item.price?'最近收盤參考價 '+(item.as_of||''):'';
    button.append(monogram,label,value);button.onclick=()=>selectInstrument(symbol);$('watchlist').append(button);
  }
}
async function hydrateWatchlist() {
  try {const data=await api('/instruments');for(const item of data.items)instrumentMap.set(item.symbol,item);renderWatchlist();}
  catch { /* Selected quote and manual orders remain available on a partial outage. */ }
}
$('symbol').onchange=()=>selectInstrument($('symbol').value);
function hideSearch() { clearTimeout(searchTimer);++searchSerial;$('search-results').hidden=true;$('stock-search').setAttribute('aria-expanded','false');$('stock-search').removeAttribute('aria-activedescendant'); }
function activateSearch(index) { searchActive=index;for(const [i,row] of [...$('search-results').children].entries()){row.classList.toggle('active',i===index);row.setAttribute('aria-selected',String(i===index));}if(index>=0){$('stock-search').setAttribute('aria-activedescendant','stock-result-'+index);$('search-results').children[index].scrollIntoView({block:'nearest'});} }
function chooseSearch(index) { const item=searchItems[index];if(item)selectInstrument(item.symbol); }
async function searchStocks() {
  if(!ready)return;
  const serial=++searchSerial;$('search-status').textContent='搜尋官方上市櫃資料…';
  const params=new URLSearchParams({q:$('stock-search').value.trim()});
  for(const [id,key] of [['min-price','min_price'],['max-price','max_price']])if($(id).value!=='')params.set(key,$(id).value);
  try {
    const data=await api('/instruments?'+params);if(serial!==searchSerial)return;
    searchItems=data.items;searchActive=-1;$('search-results').replaceChildren();
    $('search-status').textContent=(data.total?'找到 '+data.total+' 檔'+(data.total>20?'，先顯示 20 檔':'')+' · 價格為最近收盤參考':'沒有符合的普通股。可清除價格條件；本版不含 ETF、TDR 與權證。')+(data.sources.some(s=>s.status!=='available')?' · 部分來源暫不可用或使用舊快取':'');
    for(const [i,item] of data.items.entries()) {
      instrumentMap.set(item.symbol,item);
      const row=document.createElement('button');row.type='button';row.className='search-result';row.id='stock-result-'+i;row.setAttribute('role','option');row.setAttribute('aria-selected','false');
      const title=document.createElement('strong');title.textContent=item.symbol+' '+item.name;
      const price=document.createElement('span');price.className='result-price';price.textContent=item.price?money(item.price):'無價格';
      const market=document.createElement('small');market.textContent=(item.exchange==='TPEx'?'上櫃':'上市')+' · '+item.as_of;
      const kind=document.createElement('small');kind.textContent=item.stale_cache?'舊快取':'收盤參考';
      row.append(title,price,market,kind);row.onmousedown=e=>e.preventDefault();row.onclick=()=>chooseSearch(i);$('search-results').append(row);
    }
    $('search-results').hidden=!data.items.length;$('stock-search').setAttribute('aria-expanded',String(!!data.items.length));
  } catch(error){if(serial!==searchSerial)return;hideSearch();$('search-status').textContent=error.message+'；可保留目前標的手動下單。';}
}
function scheduleSearch() { clearTimeout(searchTimer);hideSearch();searchItems=[];$('search-status').textContent='搜尋中…';searchTimer=setTimeout(searchStocks,240); }
$('stock-search').addEventListener('input',event=>{searchDirty=true;if(!event.isComposing)scheduleSearch();});
$('stock-search').addEventListener('focus',()=>{ $('stock-search').select();scheduleSearch(); });
for(const id of ['min-price','max-price'])$(id).addEventListener('input',()=>{if($('stock-search').value===$('symbol').value+' '+symbolName($('symbol').value))$('stock-search').value='';searchDirty=true;scheduleSearch();});
$('reset-search').onclick=()=>{$('stock-search').value='';$('min-price').value='';$('max-price').value='';$('stock-search').focus();searchDirty=true;scheduleSearch();};
$('stock-search').addEventListener('keydown',event=>{
  if(event.key==='Escape'){hideSearch();$('stock-search').value=$('symbol').value+' '+symbolName($('symbol').value);searchDirty=false;$('search-status').textContent='已保留目前下單標的。';return;}
  if(event.key==='Enter'){event.preventDefault();if(!$('search-results').hidden)chooseSearch(searchActive<0?0:searchActive);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if($('search-results').hidden){searchStocks();return;}if(searchItems.length)activateSearch((searchActive+(event.key==='ArrowDown'?1:-1)+searchItems.length)%searchItems.length);}
});
document.addEventListener('click',event=>{if(!$('instrument-picker').contains(event.target))hideSearch();});
async function loadQuote(manual=false) {
  if(!ready)return;
  const serial=++quoteSerial,symbol=$('symbol').value,market=$('market-type').value;
  if(!priceDirty){$('price').value='';updateEstimate();}
  quoteData=null;$('quote-label').textContent='參考價格';$('quote-price').textContent='載入中';$('quote-meta').textContent='正在確認來源與更新時間…';$('refresh-quote').disabled=true;$('use-quote').disabled=true;
  try {
    const data=await api('/market/'+symbol+'?market_type='+market);
    if(serial!==quoteSerial||symbol!==$('symbol').value||market!==$('market-type').value)return;
    quoteData=data.quote;instrumentMap.set(symbol,data.instrument);renderWatchlist();
    $('quote-label').textContent=referenceLabel(quoteData);$('quote-price').textContent=quoteData.price?money(quoteData.price):'未提供';
    $('quote-meta').textContent=quoteData.source+' · '+dateLabel(quoteData.as_of)+(quoteData.stale_cache?' · 舊快取':'')+'\n'+quoteData.reason+'\n資料取得 '+dateLabel(quoteData.fetched_at);
    $('use-quote').disabled=!quoteData.price;
    if(!priceDirty&&quoteData.price)useQuote();else updatePriceOrigin();
    if(manual)toast(priceDirty?'報價已更新，已保留你的自訂限價':'參考價格已更新');
  }catch(error){if(serial!==quoteSerial)return;$('quote-price').textContent='暫無資料';$('quote-meta').textContent=error.message+'。可自行輸入限價，委託不會自動成交。';updatePriceOrigin();}
  finally{if(serial===quoteSerial)$('refresh-quote').disabled=false;}
}
$('refresh-quote').onclick=()=>loadQuote(true);
function detail(target,rows,note) { const dl=document.createElement('dl');for(const [name,value] of rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;row.append(dt,dd);dl.append(row);}const small=document.createElement('small');small.textContent=note;$(target).replaceChildren(dl,small); }
const pct=value=>value===null||value===undefined?'未提供':(value>0?'+':'')+value.toFixed(2)+'%';
function net(value) { return value===null||value===undefined?'未提供':(value>0?'+':'')+value.toLocaleString('zh-TW')+' 股'; }
function chartEmpty(message) { $('price-chart').setAttribute('hidden','');$('chart-values').hidden=true;$('chart-empty').hidden=false;$('chart-empty').querySelector('strong').textContent=message;$('chart-empty').querySelector('p').textContent='沒有完整資料時，不繪製推估線。';$('chart-axis').replaceChildren(); }
async function loadHistory(symbol,serial) {
  chartEmpty('正在取得官方日線…');$('chart-status').textContent='歷史資料載入中';$('chart-source').textContent='官方資料';$('technical-detail').textContent='正在取得歷史日線…';$('facet-technical').textContent='載入中';
  try {
    const data=await api('/history/'+symbol);if(serial!==selectionSerial)return;
    $('chart-source').textContent=data.source+' · 日線';$('facet-technical').textContent=data.sma20?money(data.sma20):'資料不足';
    if(!data.bars.length){chartEmpty(data.reason||'暫無歷史日線資料');$('chart-status').textContent='未繪製走勢';$('technical-detail').textContent=data.reason||'歷史資料暫時無法使用';return;}
    const bars=data.bars,low=Math.min(...bars.map(b=>b.close)),high=Math.max(...bars.map(b=>b.close)),range=high-low||1;
    const points=bars.map((b,i)=>[12+i/Math.max(1,bars.length-1)*776,265-(b.close-low)/range*235]);
    const svg=$('price-chart');svg.replaceChildren();
    const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',points.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#d4ff5a');line.setAttribute('stroke-width','2.4');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',String(points.at(-1)[0]));dot.setAttribute('cy',String(points.at(-1)[1]));dot.setAttribute('r','4');dot.setAttribute('fill','#d4ff5a');svg.append(dot);svg.removeAttribute('hidden');document.querySelector('.chart').setAttribute('aria-label',symbol+' '+symbolName(symbol)+'，截至 '+data.as_of+' 的 '+bars.length+' 筆官方歷史收盤價');
    $('chart-empty').hidden=true;$('chart-values').hidden=false;$('chart-values').replaceChildren();
    for(const value of ['最高收盤 '+money(high),'最低收盤 '+money(low)]){const span=document.createElement('span');span.textContent=value;$('chart-values').append(span);}
    $('chart-axis').replaceChildren();for(const index of [0,Math.floor((bars.length-1)/2),bars.length-1]){const span=document.createElement('span');span.textContent=bars[index].date.slice(5).replace('-','/');$('chart-axis').append(span);}
    $('chart-status').textContent='未還原日線 · 截至 '+data.as_of;
    detail('technical-detail',[['資料筆數',bars.length+' 個交易日'],['SMA20',data.sma20?money(data.sma20):'不足 20 日'],['SMA60',data.sma60?money(data.sma60):'不足 60 日']],data.source+' · '+data.as_of+'\n'+data.note+(data.warnings.length?'\n部分月份未完整取得':''));
  }catch(error){if(serial!==selectionSerial)return;chartEmpty('歷史資料暫時無法使用');$('chart-status').textContent='可重新選股重試';$('facet-technical').textContent='暫無資料';$('technical-detail').textContent=error.message;}
}
async function loadResearch(symbol,serial) {
  $('facet-fundamental').textContent='載入中';$('facet-ownership').textContent='載入中';$('fundamental-detail').textContent='正在取得官方營收與估值…';$('ownership-detail').textContent='正在取得官方法人資料…';
  try {
    const data=await api('/research/'+symbol);if(serial!==selectionSerial)return;
    const f=data.fundamentals,r=f.revenue,v=f.valuation,o=data.ownership;
    $('facet-fundamental').textContent=r?pct(r.yoy_percent):'未提供';
    const period=r?.period?String(Number(String(r.period).slice(0,-2))+1911)+'/'+String(r.period).slice(-2):'未提供';
    detail('fundamental-detail',[['營收月份',period],['營收年增率',r?pct(r.yoy_percent):'未提供'],['營收月增率',r?pct(r.mom_percent):'未提供'],['本益比',v?.pe??'未提供'],['股價淨值比',v?.pb??'未提供'],['殖利率',v?.dividend_yield_percent!=null?v.dividend_yield_percent.toFixed(2)+'%':'未提供']],f.source+'\n營收出表日 '+(r?.report_date||'未提供')+'\n估值日期 '+(v?.as_of||'未提供')+((r?.stale_cache||v?.stale_cache)?'\n目前為舊快取':''));
    $('facet-ownership').textContent=o.status==='available'?net(o.total_net_shares):'未提供';
    if(o.status==='available')detail('ownership-detail',[['外陸資淨買賣',net(o.foreign_net_shares)],['投信淨買賣',net(o.trust_net_shares)],['自營商淨買賣',net(o.dealer_net_shares)],['三大法人合計',net(o.total_net_shares)]],o.source+' · '+o.as_of+'\n'+o.note+(o.stale_cache?'\n目前為舊快取':''));
    else $('ownership-detail').textContent=o.reason;
  }catch(error){if(serial!==selectionSerial)return;$('facet-fundamental').textContent='暫無資料';$('facet-ownership').textContent='暫無資料';$('fundamental-detail').textContent=error.message;$('ownership-detail').textContent=error.message;}
}

function formatHolding(shares) {
  const lots=Math.floor(shares/1000), remainder=shares%1000;
  return lots ? lots+' 張'+(remainder?' '+remainder+' 股':'') : shares+' 股';
}
function updateEstimate() {
  const board=$('market-type').value==='board_lot', units=Number($('quantity').value);
  const valid=Number.isInteger(units)&&units>=1&&units<=(board?499:999);
  const shares=units*(board?1000:1), price=Math.round(Number($('price').value)*100);
  $('quantity-summary').textContent=valid?(board?units.toLocaleString('zh-TW')+' 張 = '+shares.toLocaleString('zh-TW')+' 股':shares.toLocaleString('zh-TW')+' 股 · 零股委託'):(board?'整股請輸入 1～499 張':'零股請輸入 1～999 股');
  const sell=$('side').value==='sell';
  $('estimated-tax-row').hidden=!sell;
  $('estimate-total-label').textContent=sell?'預估賣出淨額':'預估保留金額';
  $('budget-note').textContent='';
  if(!valid||!Number.isSafeInteger(price)||price<=0) {
    for(const id of ['estimated-gross','estimated-fee','estimated-tax','estimated-total']) $(id).textContent='—';
    return;
  }
  const gross=shares*price, fee=Math.max(2000,Math.round(gross*1425/1000000)), tax=sell?Math.round(gross*3/1000):0;
  $('estimated-gross').textContent=money(gross);$('estimated-fee').textContent=money(fee);$('estimated-tax').textContent=money(tax);
  $('estimated-total').textContent=money(sell?gross-fee-tax:gross+fee);
  if(!sell&&gross>6000000) $('budget-note').textContent='超過單筆 NT$60,000 上限，請調整數量或改用零股。';
  else if(account&&!sell) {
    const reserved=account.orders.filter(o=>o.status==='pending'&&o.side==='buy').reduce((a,o)=>a+o.reserved,0);
    if(gross+fee>account.cash-reserved) $('budget-note').textContent='可用模擬資金不足，請調整數量。';
  } else if(account&&sell) {
    const symbol=$('symbol').value;
    const reserved=account.orders.filter(o=>o.status==='pending'&&o.side==='sell'&&o.symbol===symbol).reduce((a,o)=>a+o.quantity,0);
    if(shares>(account.positions[symbol]||0)-reserved) $('budget-note').textContent='可賣股數不足；整股與零股委託共用持倉。';
  }
}
function setMarketType(market) {
  const previous=$('market-type').value;
  if(previous===market) return;
  const old=Number($('quantity').value);
  if(Number.isInteger(old)&&old>=1&&old<=(previous==='board_lot'?499:999)) quantityDraft[previous]=old;
  $('market-type').value=market;
  const board=market==='board_lot';
  $('quantity-label').textContent=board?'委託張數（張）':'委託股數（股）';
  $('quantity').max=board?'499':'999';$('quantity').value=quantityDraft[market];
  for(const [id,selected] of [['board-lot',board],['odd-lot',!board]]) { $(id).classList.toggle('selected',selected);$(id).setAttribute('aria-pressed',String(selected)); }
  updateEstimate();
  if(ready)loadQuote();
}
$('board-lot').onclick=()=>setMarketType('board_lot');
$('odd-lot').onclick=()=>setMarketType('odd_lot');
for(const id of ['quantity','price','side']) $(id).addEventListener('input',updateEstimate);
$('symbol').addEventListener('change',updateEstimate);
async function refresh() { account=await api('/account'); render(); }
let reviewedOrder=null;
$('order-form').onsubmit=event=>{
  event.preventDefault();$('error').hidden=true;
  if(!account){showError(new Error('請先登入並載入帳戶'));return;}
  if(searchDirty){showError(new Error('請先從搜尋結果選擇下單標的，再確認委託。'));$('stock-search').focus();return;}
  updateEstimate();if($('budget-note').textContent){showError(new Error($('budget-note').textContent));return;}
  const market=$('market-type').value;
  const body={symbol:$('symbol').value,side:$('side').value,market_type:market,quantity:Number($('quantity').value)*(market==='board_lot'?1000:1),limit_price:Math.round(Number($('price').value)*100)};
  const tick=tickForPrice(body.limit_price);
  if(body.limit_price%tick){showError(new Error('此價位每檔為 NT$'+(tick/100)+'，可用 ＋／− 調整到有效價格。'));return;}
  const payload=JSON.stringify(body);if(!pendingRequest||pendingRequest.payload!==payload)pendingRequest={payload,key:crypto.randomUUID()};
  reviewedOrder={...pendingRequest};
  const dl=document.createElement('dl');
  for(const [name,value] of [['標的',body.symbol+' '+symbolName(body.symbol)],['方向',body.side==='buy'?'買入':'賣出'],['類別',market==='board_lot'?'整股':'零股'],['數量',market==='board_lot'?body.quantity/1000+' 張（'+body.quantity.toLocaleString('zh-TW')+' 股）':body.quantity+' 股'],['每股限價',money(body.limit_price)],['預估金額',$('estimated-total').textContent],['價格來源',priceDirty?'自訂限價':quoteData?referenceLabel(quoteData)+' · '+quoteData.source:'自行輸入']]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  $('review-summary').replaceChildren(dl);$('order-review').returnValue='cancel';$('order-review').showModal();
};
$('order-review').addEventListener('cancel',()=>{reviewedOrder=null;});
$('order-review').addEventListener('close',async()=>{
  if($('order-review').returnValue!=='confirm'||!reviewedOrder)return;
  const request=reviewedOrder;reviewedOrder=null;$('submit-order').disabled=true;
  try{await api('/orders',{method:'POST',headers:{'Idempotency-Key':request.key},body:request.payload});pendingRequest=null;await refresh();view('activity');toast('模擬委託已建立，尚未成交');}
  catch(error){showError(error);}
  finally{$('submit-order').disabled=false;}
});
for(const nav of document.querySelectorAll('.nav')) nav.onclick=()=>view(nav.dataset.view);
$('open-analysis').onclick=()=>view('analysis');
$('refresh').onclick=()=>refresh().catch(showError);
$('login').onclick=()=>login().catch(showError);
$('logout').onclick=()=>{sessionStorage.removeItem('baglo_token');if(config?.auth_domain){const url=new URL(config.auth_domain+'/logout');url.search=new URLSearchParams({client_id:config.client_id,logout_uri:location.origin+'/'});location.assign(url);}else location.assign('/');};
(async()=>{
  try {
    const settingsResponse=await fetch('/config.json');
    if(!settingsResponse.ok) throw new Error('無法讀取網站設定');
    const settings=await settingsResponse.json();
    apiBase=(settings.api_base||'').replace(/\/$/,'');
    config=await api('/config');
    $('mode').textContent=config.demo?'本機沙盒 · 示範成交':config.environment==='local'?'本機模擬':'PAPER / '+config.environment.toUpperCase();
    $('notice').textContent=config.demo?'本機沙盒：報價與圖表使用真實資料；「沙盒成交」只按委託限價示範帳務，不代表市場成交或策略績效。':'純模擬交易：可查閱市場參考資料；本版委託保持待成交，不自動撮合。';
    for(const item of config.symbols){instrumentMap.set(item.symbol,item);watchSymbols.push(item.symbol); const option=document.createElement('option');option.value=item.symbol;option.textContent=item.symbol+' '+item.name;$('symbol').append(option); }
    renderWatchlist();
    updateEstimate();
    await finishLogin();
    const authenticated=config.environment==='local'||!!sessionStorage.getItem('baglo_token');
    $('login').hidden=authenticated;$('logout').hidden=!sessionStorage.getItem('baglo_token');
    if(authenticated) {await refresh();ready=true;selectInstrument($('symbol').value);}
    else { $('notice').textContent='請先登入，開啟你的獨立模擬帳戶。';$('submit-order').disabled=true; }
  } catch(error){showError(error);$('notice').textContent='尚未連接帳戶，請確認服務或重新登入。';$('submit-order').disabled=true;if(config?.environment!=='local')$('login').hidden=false;}
})();
