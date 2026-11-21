'use strict';
const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('zh-TW', {style:'currency',currency:'TWD',maximumFractionDigits:2}).format(cents/100);
let config, account, pendingRequest, apiBase='';
const quantityDraft={odd_lot:10,board_lot:1};
const statusNames = {pending:'待成交',filled:'已成交',cancelled:'已取消'};
function showError(error) { $('error').textContent=error.message; $('error').hidden=false; }
function view(name) { for(const section of document.querySelectorAll('.view')) section.hidden=section.id!==name; for(const nav of document.querySelectorAll('.nav')) nav.classList.toggle('active',nav.dataset.view===name); }
async function api(path, options={}) {
  const headers={'Content-Type':'application/json',...options.headers};
  const token=sessionStorage.getItem('baglo_token');
  if(token) headers.Authorization='Bearer '+token;
  const response=await fetch(apiBase+'/api'+path,{...options,headers});
  let data; try { data=await response.json(); } catch { throw new Error('服務未回傳有效資料，請稍後再試。'); }
  if(!response.ok) { if(response.status===401) sessionStorage.removeItem('baglo_token'); throw new Error(data.error||'服務暫時無法使用'); }
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
  else { $('positions').className=''; const ul=document.createElement('ul'); for(const [symbol,quantity] of positions) { const li=document.createElement('li'); const label=document.createElement('span'), value=document.createElement('strong'); label.textContent=symbol+' '+(config.symbols.find(x=>x.symbol===symbol)?.name||'');value.textContent=formatHolding(quantity);li.append(label,value);ul.append(li); } $('positions').append(ul); }
  $('orders').replaceChildren(); $('no-orders').hidden=account.orders.length>0;
  for(const order of [...account.orders].reverse()) {
    const tr=document.createElement('tr');
    const market=order.market_type||(order.quantity%1000===0?'board_lot':order.quantity<1000?'odd_lot':'legacy');
    const quantityText=market==='board_lot'?(order.quantity/1000)+' 張（'+order.quantity.toLocaleString('zh-TW')+' 股）':order.quantity.toLocaleString('zh-TW')+' 股';
    for(const value of [order.symbol,order.side==='buy'?'買入':'賣出',market==='board_lot'?'整股':market==='odd_lot'?'零股':'舊制',quantityText,money(order.limit_price)]) { const td=document.createElement('td'); td.textContent=value; tr.append(td); }
    const status=document.createElement('td'), badge=document.createElement('span'); badge.className='status '+order.status;badge.textContent=statusNames[order.status];status.append(badge);tr.append(status);
    const actions=document.createElement('td');
    if(order.status==='pending') {
      for(const [name,action] of [['取消','cancel'],...(config.demo?[['沙盒成交','demo-fill']]:[])]) {
        const button=document.createElement('button');button.textContent=name;
        button.onclick=async()=>{ button.disabled=true;try{await api('/orders/'+encodeURIComponent(order.id)+'/'+action,{method:'POST',body:'{}'});await refresh();}catch(e){showError(e);button.disabled=false;} };
        actions.append(button);
      }
    }
    tr.append(actions);$('orders').append(tr);
  }
  updateEstimate();
}
function selectInstrument(symbol) {
  $('symbol').value=symbol;
  const item=config.symbols.find(x=>x.symbol===symbol);
  if(item) { $('chart-symbol').textContent=item.symbol+' '+item.name; $('chart-monogram').textContent=item.name.slice(0,1); }
  for(const row of document.querySelectorAll('.watch-item')) { const selected=row.dataset.symbol===symbol;row.classList.toggle('selected',selected);row.setAttribute('aria-pressed',String(selected)); }
}
function renderWatchlist() {
  $('watchlist').replaceChildren();
  for(const item of config.symbols) {
    const button=document.createElement('button');button.type='button';button.className='watch-item';button.dataset.symbol=item.symbol;
    button.setAttribute('aria-label','選擇 '+item.symbol+' '+item.name);
    const monogram=document.createElement('span');monogram.className='stock-monogram';monogram.textContent=item.name.slice(0,1);
    const label=document.createElement('span');label.className='stock-label';label.textContent=item.name;
    const code=document.createElement('small');code.textContent=item.symbol;label.append(code);
    const arrow=document.createElement('span');arrow.className='watch-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
    button.append(monogram,label,arrow);button.onclick=()=>selectInstrument(item.symbol);$('watchlist').append(button);
  }
  selectInstrument($('symbol').value);
}
$('symbol').onchange=()=>selectInstrument($('symbol').value);
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
}
$('board-lot').onclick=()=>setMarketType('board_lot');
$('odd-lot').onclick=()=>setMarketType('odd_lot');
for(const id of ['quantity','price','side']) $(id).addEventListener('input',updateEstimate);
$('symbol').addEventListener('change',updateEstimate);
async function refresh() { account=await api('/account'); render(); }
$('order-form').onsubmit=async event=>{
  event.preventDefault();$('error').hidden=true;$('submit-order').disabled=true;
  const market=$('market-type').value;
  const body={symbol:$('symbol').value,side:$('side').value,market_type:market,quantity:Number($('quantity').value)*(market==='board_lot'?1000:1),limit_price:Math.round(Number($('price').value)*100)};
  const payload=JSON.stringify(body);
  if(!pendingRequest||pendingRequest.payload!==payload) pendingRequest={payload,key:crypto.randomUUID()};
  try { await api('/orders',{method:'POST',headers:{'Idempotency-Key':pendingRequest.key},body:payload});pendingRequest=null;await refresh();view('activity'); }
  catch(error){showError(error);} finally{$('submit-order').disabled=false;}
};
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
    $('notice').textContent=config.demo?'本機沙盒：可用「沙盒成交」驗證帳務。價格來自你輸入的限價，不是真實行情，績效不可用於評估策略。':'純模擬交易：委託暫保持待成交，行情與 AI 接入完成前不自動撮合。';
    for(const item of config.symbols){ const option=document.createElement('option');option.value=item.symbol;option.textContent=item.symbol+' '+item.name;$('symbol').append(option); }
    renderWatchlist();
    updateEstimate();
    await finishLogin();
    const authenticated=config.environment==='local'||!!sessionStorage.getItem('baglo_token');
    $('login').hidden=authenticated;$('logout').hidden=!sessionStorage.getItem('baglo_token');
    if(authenticated) await refresh();
    else { $('notice').textContent='請先登入，開啟你的獨立模擬帳戶。';$('submit-order').disabled=true; }
  } catch(error){showError(error);$('notice').textContent='尚未連接帳戶，請確認服務或重新登入。';$('submit-order').disabled=true;if(config?.environment!=='local')$('login').hidden=false;}
})();
