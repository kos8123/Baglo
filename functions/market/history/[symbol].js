const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  "X-Content-Type-Options": "nosniff",
};

function fromFullHistory(data, months, offset) {
  const now = new Date();
  const taipei = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const latest = taipei.getFullYear() * 12 + taipei.getMonth() - offset;
  const earliest = latest - months + 1;
  const bars = (data.bars || []).filter((bar) => {
    const [year, month] = String(bar.date).split("-").map(Number);
    const index = year * 12 + month - 1;
    return index >= earliest && index <= latest;
  });
  const sma = (count) => bars.length >= count
    ? Math.round(bars.slice(-count).reduce((sum, bar) => sum + bar.close, 0) / count)
    : null;
  return { ...data, bars, sma20: sma(20), sma60: sma(60), as_of: bars.at(-1)?.date || null };
}

export async function onRequestGet({ env, params, request }) {
  const symbol = String(params.symbol || "");
  const input = new URL(request.url);
  const months = Number(input.searchParams.get("months") || "3");
  const offset = Number(input.searchParams.get("offset") || "0");
  if (!/^[1-8]\d{3}$/.test(symbol) || !Number.isInteger(months) || months < 1 || months > 120 || !Number.isInteger(offset) || offset < 0 || offset > 114)
    return new Response(JSON.stringify({ error: "K 線查詢範圍不正確" }), { status: 400, headers: jsonHeaders });

  const origin = String(env.BAGLO_API_BASE || "").replace(/\/$/, "");
  if (!origin.startsWith("https://"))
    return new Response(JSON.stringify({ error: "尚未設定行情來源" }), { status: 503, headers: jsonHeaders });

  const bucket = env.BAGLO_MARKET_CACHE;
  const key = `history/v1/${symbol}/${months}/${offset}.json`;
  let cached = null;
  if (bucket) {
    cached = await bucket.get(key);
    const saved = Number(cached?.customMetadata?.savedAt || 0);
    if (cached && Date.now() - saved < 6 * 3600_000)
      return new Response(cached.body, { headers: { ...jsonHeaders, "X-Baglo-Cache": "HIT" } });
    const full = await bucket.get(`history/v1/${symbol}/full.json`);
    if (full) {
      const data = fromFullHistory(await full.json(), months, offset);
      if (data.bars.length)
        return new Response(JSON.stringify(data), { headers: { ...jsonHeaders, "X-Baglo-Cache": "PREFILL" } });
    }
  }

  try {
    const upstreamMonths = Math.min(months, 6);
    const upstream = await fetch(`${origin}/api/history/${symbol}?months=${upstreamMonths}&offset=${offset}`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const body = await upstream.arrayBuffer();
    if (!upstream.ok)
      return new Response(body, { status: upstream.status, headers: { ...jsonHeaders, "X-Baglo-Cache": "MISS" } });
    if (bucket && months <= 6)
      await bucket.put(key, body, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { savedAt: String(Date.now()) },
      });
    return new Response(body, { headers: { ...jsonHeaders, "X-Baglo-Cache": "MISS" } });
  } catch {
    if (cached)
      return new Response(cached.body, { headers: { ...jsonHeaders, "X-Baglo-Cache": "STALE", Warning: '110 - "Response is stale"' } });
    return new Response(JSON.stringify({ error: "K 線資料暫時無法取得" }), { status: 503, headers: jsonHeaders });
  }
}
