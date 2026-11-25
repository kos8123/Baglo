const BACKFILL_SCAN_SIZE = 10;
const REFRESH_BATCH_SIZE = 40;
const TARGET_MONTHS = 120;
const ORDER_VERSION = 2;
// Version 2: TPEx months before 2025 (labelled 成交仟股) were dropped by the parser.
// Stored TPEx histories older than this are backfilled again; TWSE ones are only re-tagged.
const HISTORY_VERSION = "2";
const CATALOG_SOURCES = [
  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
];
const PRIORITY_SYMBOLS = ["2330", "2317", "2454", "2308", "2881", "2882"];
// Gap pass 1: early backfills kept whole months whose fetch failed transiently (the source
// has them). Each stored history is checked once and its missing months fetched again.
const GAP_VERSION = "1";
const GAP_SCAN_SIZE = 25;
const GAP_FETCH_BUDGET = 12;
const MAX_OFFSET = 114;

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
  // Official sources sometimes refuse a burst of requests; retry chunks with missing
  // months once, one at a time. Months still missing are usually before the listing date.
  for (let index = 0; index < parts.length; index += 1) {
    if (!(parts[index]?.warnings || []).some((warning) => warning.includes("暫無資料"))) continue;
    try {
      parts[index] = await fetchHistory(origin, symbol, 6, offsets[index]);
    } catch {
      // Keep the first result; the daily refresh and next repair pass can fill it later.
    }
  }
  await bucket.put(`history/v1/${symbol}/full.json`, JSON.stringify(mergeHistory(parts)), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { savedAt, months: String(TARGET_MONTHS), version: HISTORY_VERSION },
  });
}

async function refreshSymbol(origin, bucket, symbol, savedAt) {
  const current = await fetchHistory(origin, symbol, 1, 0);
  const object = await bucket.get(`history/v1/${symbol}/full.json`);
  const stored = object ? await object.json() : null;
  const merged = mergeHistory(stored ? [stored, current] : [current]);
  await bucket.put(`history/v1/${symbol}/full.json`, JSON.stringify(merged), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    // Keep the stored version so a refresh never marks an unrepaired history as repaired.
    customMetadata: {
      savedAt, months: String(stored ? TARGET_MONTHS : 1),
      version: object?.customMetadata?.version || "", gaps: object?.customMetadata?.gaps || "",
    },
  });
}

// True when a symbol's stored history must be fetched again: no file, TPEx saved before
// HISTORY_VERSION (parser bug), or a last bar weeks old (a gap a one-month refresh never
// closes). Healthy TWSE files from before the version are only re-tagged.
async function needsBackfill(bucket, symbol) {
  const key = `history/v1/${symbol}/full.json`;
  const object = await bucket.get(key);
  if (!object) return true;
  if (object.customMetadata?.version === HISTORY_VERSION) return false;
  const stored = await object.json();
  const staleBefore = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  if (stored.source === "TPEx" || !stored.as_of || stored.as_of < staleBefore) return true;
  await bucket.put(key, JSON.stringify(stored), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { ...object.customMetadata, version: HISTORY_VERSION },
  });
  return false;
}

const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

// Months between the first stored bar and last month that have no bars, as month indexes.
function missingMonths(stored, today) {
  const bars = stored?.bars || [];
  if (!bars.length) return [];
  const have = new Set(bars.map((bar) => monthIndex(bar.date)));
  const missing = [];
  for (let month = monthIndex(bars[0].date); month < monthIndex(today); month += 1) {
    if (!have.has(month)) missing.push(month);
  }
  return missing;
}

// Requests (months, offset) that cover the missing months with as few calls as possible.
// The API serves at most 6 months per call and offsets up to MAX_OFFSET months back.
function gapRequests(missing, today) {
  const current = monthIndex(today);
  const requests = [];
  let index = 0;
  while (index < missing.length) {
    const start = missing[index];
    let end = Math.min(start + 5, current - 1);
    let months = end - start + 1;
    if (current - end > MAX_OFFSET) {
      end = current - MAX_OFFSET;
      months = 6;
    }
    requests.push({ months, offset: current - end });
    while (index < missing.length && missing[index] <= end) index += 1;
  }
  return requests;
}

// Fetches the months missing from one stored history. A history with more gaps than one
// run's budget is filled across runs: `gapsFrom` records the last month already requested.
async function fillGaps(origin, bucket, symbol, today, budget) {
  const key = `history/v1/${symbol}/full.json`;
  const object = await bucket.get(key);
  if (!object || object.customMetadata?.gaps === GAP_VERSION) return { used: 0, done: true };
  const stored = await object.json();
  const from = Number(object.customMetadata?.gapsFrom || -1);
  const requests = gapRequests(missingMonths(stored, today).filter((month) => month > from), today);
  if (requests.length > budget && budget < GAP_FETCH_BUDGET) return { used: 0, done: false };
  const batch = requests.slice(0, budget);
  const parts = [stored];
  for (const { months, offset } of batch) {
    try {
      parts.push(await fetchHistory(origin, symbol, months, offset));
    } catch {
      // A month that still fails stays missing; this pass does not retry it.
    }
  }
  const done = batch.length === requests.length;
  const merged = mergeHistory(parts);
  const filled = new Set(merged.bars.map((bar) => bar.date.slice(0, 7).replace("-", "")));
  merged.warnings = merged.warnings.filter((warning) => !(warning.includes("暫無資料") && filled.has(warning.slice(0, 6))));
  const metadata = { ...object.customMetadata };
  if (done) {
    metadata.gaps = GAP_VERSION;
    delete metadata.gapsFrom;
  } else {
    metadata.gapsFrom = String(monthIndex(today) - batch.at(-1).offset);
  }
  await bucket.put(key, JSON.stringify(merged), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: metadata,
  });
  return { used: batch.length, done };
}

// After the repair pass, checks every stored history once for missing months.
async function gapNext(origin, bucket, catalog, state, today) {
  if (!state.repairDone || (state.gapVersion === GAP_VERSION && state.gapDone)) return state;
  // Wait for today's refresh: its 40 requests plus these would pass the per-run subrequest limit.
  if (state.completedDay !== today) return state;
  let cursor = state.gapVersion === GAP_VERSION ? state.gapCursor || 0 : 0;
  const stop = Math.min(catalog.items.length, cursor + GAP_SCAN_SIZE);
  let budget = GAP_FETCH_BUDGET;
  while (cursor < stop && budget > 0) {
    const { used, done } = await fillGaps(origin, bucket, catalog.items[cursor].symbol, today, budget);
    budget -= used;
    if (!done) break;
    cursor += 1;
  }
  const done = cursor >= catalog.items.length;
  return { ...state, gapVersion: GAP_VERSION, gapCursor: done ? 0 : cursor, gapDone: done };
}

// During the refresh phase, repairs histories saved before HISTORY_VERSION one symbol per
// run, so recent bars keep updating while old months are filled in.
async function repairNext(origin, bucket, catalog, state) {
  if (state.repairVersion === HISTORY_VERSION && state.repairDone) return state;
  let cursor = state.repairVersion === HISTORY_VERSION ? state.repairCursor || 0 : 0;
  const stop = Math.min(catalog.items.length, cursor + BACKFILL_SCAN_SIZE);
  while (cursor < stop) {
    const { symbol } = catalog.items[cursor++];
    if (await needsBackfill(bucket, symbol)) {
      await backfillSymbol(origin, bucket, symbol, String(Date.now()));
      break;
    }
  }
  const done = cursor >= catalog.items.length;
  return { ...state, repairVersion: HISTORY_VERSION, repairCursor: done ? 0 : cursor, repairDone: done };
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

  if (state.phase === "refresh") {
    let updated = await repairNext(origin, bucket, catalog, state);
    updated = await gapNext(origin, bucket, catalog, updated, today);
    if (updated !== state) {
      state = updated;
      await bucket.put("sync/state.json", JSON.stringify(state), { httpMetadata: { contentType: "application/json" } });
    }
  }
  if (state.completedDay === today) return;

  let items;
  let next;
  if (state.phase === "backfill") {
    items = [];
    next = state.cursor;
    const stop = Math.min(catalog.items.length, state.cursor + BACKFILL_SCAN_SIZE);
    while (next < stop) {
      const candidate = catalog.items[next++];
      if (!await needsBackfill(bucket, candidate.symbol)) continue;
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
    // Finishing a backfill does not count as today's refresh: run one right after it.
    completedDay: complete && state.phase === "refresh" ? today : state.completedDay,
    phase: complete && state.phase === "backfill" ? "refresh" : state.phase,
    targetMonths: TARGET_MONTHS,
    orderVersion: ORDER_VERSION,
    repairVersion: state.repairVersion,
    repairCursor: state.repairCursor,
    repairDone: state.repairDone,
    gapVersion: state.gapVersion,
    gapCursor: state.gapCursor,
    gapDone: state.gapDone,
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
