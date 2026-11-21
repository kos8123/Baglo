/* Calendar aggregation of actual daily OHLCV. Never interpolate missing sessions. */
(function(root){
  function aggregate(bars, period='day') {
    const groups=new Map();
    for(const b of [...bars].sort((a,b)=>a.date.localeCompare(b.date))){
      let key=b.date;
      if(period==='month')key=b.date.slice(0,7);
      if(period==='week'){const d=new Date(b.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);key=d.toISOString().slice(0,10);}
      const old=groups.get(key);
      if(!old)groups.set(key,{...b,period_start:b.date,period_end:b.date});
      else{old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;old.period_end=b.date;old.volume=old.volume==null||b.volume==null?null:old.volume+b.volume;}
    }
    return [...groups.values()];
  }
  function snap(bars,index){const b=bars[Math.max(0,Math.min(bars.length-1,index))];return b?{date:b.date,price:b.close}:null;}
  const api={aggregate,snap};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BagloChart=api;
})(typeof window==='undefined'?this:window);
