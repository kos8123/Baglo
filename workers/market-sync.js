const BACKFILL_SCAN_SIZE = 10;
const REFRESH_BATCH_SIZE = 40;
const TARGET_MONTHS = 120;
const ORDER_VERSION = 2;
const CATALOG_SOURCES = [
  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
];
const PRIORITY_SYMBOLS = ["2330", "2317", "2454", "2308", "2881", "2882"];

function orderCatalog(items) {
  const bySymbol = new Map(items.map((item) => [item.symbol, item]));
  const ordered = PRIORITY_SYMBOLS.map((symbol) => bySymbol.get(symbol)).filter(Boolean);
  const used = new Set(ordered.map((item) => item.symbol));
  const groups = new Map();
  for (const item of items) {
    if (used.has(item.symbol)) continue;
    const group = groups.get(item.symbol[0]) || [];
    group.push(item);
    groups.set(item.symbol[0], group);
  }
  const keys = [...groups.keys()].sort();
  for (const group of groups.values()) group.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const indexes = new Map(keys.map((key) => [key, 0]));
  while (true) {
    let added = false;
    for (const key of keys) {
      const index = indexes.get(key);
      const item = groups.get(key)[index];
      if (!item) continue;
      ordered.push(item);
      indexes.set(key, index + 1);
      added = true;
    }
    if (!added) return ordered;
  }
}

const taipeiDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

async function readJson(bucket, key, fallback) {
  const object = await bucket.get(key);
  return object ? object.json() : fallback;
}

async function loadCatalog() {
  const responses = await Promise.all(CATALOG_SOURCES.map((url) => fetch(url)));
  if (responses.some((response) => !response.ok)) {
    throw new Error("Unable to load TWSE/TPEx instrument catalog");
  }
  const rows = (await Promise.all(responses.map((response) => response.json()))).flat();
  const unique = new Map();
  for (const row of rows) {
    const symbol = String(row.Code || row.SecuritiesCompanyCode || "").trim();
    const name = String(row.Name || row.CompanyName || "").trim();
    if (/^[1-8]\d{3}$/.test(symbol) && name && !unique.has(symbol)) {
      unique.set(symbol, { symbol, name });
    }
  }
  const rank = new Map(PRIORITY_SYMBOLS.map((symbol, index) => [symbol, index]));
  const items = [...unique.values()].sort((left, right) => {
    const leftRank = rank.get(left.symbol) ?? PRIORITY_SYMBOLS.length;
    const rightRank = rank.get(right.symbol) ?? PRIORITY_SYMBOLS.length;
    return leftRank - rightRank || left.symbol.localeCompare(right.symbol);
  });
  if (!items.length) throw new Error("TWSE/TPEx instrument catalog is empty");
  return { items, total: items.length, updatedAt: new Date().toISOString() };
}

async function fetchHistory(origin, symbol, months, offset) {
  const response = await fetch(`${origin}/api/history/${symbol}?months=${months}&offset=${offset}`);
  if (!response.ok) throw new Error(`Unable to load ${symbol} history at offset ${offset}`);
  return response.json();
}

function mergeHistory(parts) {
  const bars = new Map();
  const warnings = [];
  for (const part of parts) {
    for (const bar of part?.bars || []) bars.set(bar.date, bar);
    for (const warning of part?.warnings || []) warnings.push(warning);
  }
  const ordered = [...bars.values()].sort((left, right) => left.date.localeCompare(right.date));
  const sma = (count) => ordered.length >= count
    ? Math.round(ordered.slice(-count).reduce((sum, bar) => sum + bar.close, 0) / count)
    : null;
  const latest = parts.find((part) => part?.source) || {};
  return {
    bars: ordered,
    source: latest.source,
    status: ordered.length ? "available" : "unavailable",
    adjusted: false,
    sma20: sma(20),
    sma60: sma(60),
    warnings: [...new Set(warnings)],
    as_of: ordered.at(-1)?.date || null,
    note: latest.note || "官方未還原日線；除權息可能造成價格跳空，不能直接當成策略報酬",
  };
}

async function backfillSymbol(origin, bucket, symbol, savedAt) {
  const offsets = Array.from({ length: TARGET_MONTHS / 6 }, (_, index) => index * 6);
  const parts = [];
  for (let index = 0; index < offsets.length; index += 5) {
    parts.push(...await Promise.all(offsets.slice(index, index + 5)
      .map((offset) => fetchHistory(origin, symbol, 6, offset))));
  }
  await bucket.put(`history/v1/${symbol}/full.json`, JSON.stringify(mergeHistory(parts)), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { savedAt, months: String(TARGET_MONTHS) },
  });
}

async function refreshSymbol(origin, bucket, symbol, savedAt) {
  const current = await fetchHistory(origin, symbol, 1, 0);
  const stored = await readJson(bucket, `history/v1/${symbol}/full.json`, null);
  const merged = mergeHistory(stored ? [stored, current] : [current]);
  await bucket.put(`history/v1/${symbol}/full.json`, JSON.stringify(merged), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { savedAt, months: String(stored ? TARGET_MONTHS : 1) },
  });
}

async function sync(env) {
  const origin = String(env.BAGLO_API_BASE || "").replace(/\/$/, "");
  if (!origin.startsWith("https://")) throw new Error("BAGLO_API_BASE is missing");
  const bucket = env.BAGLO_MARKET_CACHE;
  const today = taipeiDay();
  let state = await readJson(bucket, "sync/state.json", {
    cursor: 0, completedDay: "", phase: "backfill", targetMonths: TARGET_MONTHS, orderVersion: ORDER_VERSION,
  });
  if (state.targetMonths !== TARGET_MONTHS || state.orderVersion !== ORDER_VERSION) {
    state = { cursor: 0, completedDay: "", phase: "backfill", targetMonths: TARGET_MONTHS, orderVersion: ORDER_VERSION };
  }
  if (state.completedDay === today) return;

  let catalog = await readJson(bucket, "sync/catalog.json", null);
  // The exchange catalog changes rarely and is already persisted in R2.
  // Do not refetch it whenever a pass starts: TPEx rejects some Cloudflare
  // egress addresses with an /errors redirect loop.
  if (!catalog?.items?.length) {
    catalog = await loadCatalog();
    await bucket.put("sync/catalog.json", JSON.stringify(catalog), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  catalog.items = orderCatalog(catalog.items);

  let items;
  let next;
  if (state.phase === "backfill") {
    items = [];
    next = state.cursor;
    const stop = Math.min(catalog.items.length, state.cursor + BACKFILL_SCAN_SIZE);
    while (next < stop) {
      const candidate = catalog.items[next++];
      const existing = await bucket.head(`history/v1/${candidate.symbol}/full.json`);
      if (existing?.customMetadata?.months === String(TARGET_MONTHS)) continue;
      items.push(candidate);
      break;
    }
  } else {
    items = catalog.items.slice(state.cursor, state.cursor + REFRESH_BATCH_SIZE);
    next = state.cursor + items.length;
  }
  const savedAt = String(Date.now());
  await Promise.all(items.map(async ({ symbol }) => {
    if (state.phase === "backfill") await backfillSymbol(origin, bucket, symbol, savedAt);
    else await refreshSymbol(origin, bucket, symbol, savedAt);
  }));

  const complete = next >= catalog.items.length;
  await bucket.put("sync/state.json", JSON.stringify({
    cursor: complete ? 0 : next,
    completedDay: complete ? today : state.completedDay,
    phase: complete && state.phase === "backfill" ? "refresh" : state.phase,
    targetMonths: TARGET_MONTHS,
    orderVersion: ORDER_VERSION,
    total: catalog.items.length,
    updatedAt: new Date().toISOString(),
  }), { httpMetadata: { contentType: "application/json" } });
}

export default {
  async scheduled(_event, env, context) {
    context.waitUntil(sync(env));
  },
  async fetch(_request, env) {
    const state = await readJson(env.BAGLO_MARKET_CACHE, "sync/state.json", {
      cursor: 0, completedDay: "", total: 0,
    });
    return Response.json({ ok: true, ...state });
  },
};
