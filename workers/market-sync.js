const BATCH_SIZE = 10;
const CATALOG_SOURCES = [
  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
];
const PRIORITY_SYMBOLS = ["2330", "2317", "2454", "2308", "2881", "2882"];

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

async function sync(env) {
  const origin = String(env.BAGLO_API_BASE || "").replace(/\/$/, "");
  if (!origin.startsWith("https://")) throw new Error("BAGLO_API_BASE is missing");
  const bucket = env.BAGLO_MARKET_CACHE;
  const today = taipeiDay();
  const state = await readJson(bucket, "sync/state.json", { cursor: 0, completedDay: "" });
  if (state.completedDay === today) return;

  let catalog = await readJson(bucket, "sync/catalog.json", null);
  if (!catalog?.items?.length || state.cursor === 0) {
    catalog = await loadCatalog();
    await bucket.put("sync/catalog.json", JSON.stringify(catalog), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  const items = catalog.items.slice(state.cursor, state.cursor + BATCH_SIZE);
  const savedAt = String(Date.now());
  await Promise.all(items.map(async ({ symbol }) => {
    const response = await fetch(`${origin}/api/history/${symbol}?months=6&offset=0`);
    if (!response.ok) return;
    const body = await response.arrayBuffer();
    await bucket.put(`history/v1/${symbol}/full.json`, body, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { savedAt },
    });
  }));

  const next = state.cursor + items.length;
  const complete = !items.length || next >= catalog.items.length;
  await bucket.put("sync/state.json", JSON.stringify({
    cursor: complete ? 0 : next,
    completedDay: complete ? today : state.completedDay,
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
