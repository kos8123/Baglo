import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesInstrument } from "../frontend/src/selection.ts";
import { submitPaperOrder } from "../frontend/src/lib.ts";
test("selected stock accepts name, normalized name, code and suffix without dirty-state false positive", () => {
  const item = { symbol: "2330", name: "台積電" };
  for (const query of [
    "台積電",
    "臺積電",
    "2330",
    "２３３０",
    "2330.TW",
    "2330 台積電",
  ])
    assert.equal(matchesInstrument(query, item), true);
  assert.equal(matchesInstrument("鴻海", item), false);
});
test("lost POST response reconciles saved order and never creates a second order", async () => {
  const oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "sessionStorage", {
    value: { getItem: () => null },
    configurable: true,
  });
  let posts = 0;
  globalThis.fetch = (async (_url, options) => {
    if (options?.method === "POST") {
      posts++;
      throw new TypeError("disconnected");
    }
    return new Response(
      JSON.stringify({ orders: [{ id: "same-key", status: "pending" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const order = await submitPaperOrder({ key: "same-key", payload: "{}" });
    assert.equal(order.id, "same-key");
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
test("validation failure is not treated as a success or automatically retried", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: "可用模擬資金不足" }), {
      status: 422,
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      submitPaperOrder({ key: "new-key", payload: "{}" }),
      /資金不足/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("read requests avoid JSON preflight headers and do not imply an uncertain order", async () => {
  const { api, ApiError } = await import("../frontend/src/lib.ts");
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_url, options) => {
    assert.equal(new Headers(options?.headers).has("Content-Type"), false);
    throw new TypeError("network unavailable");
  }) as typeof fetch;
  try {
    await assert.rejects(api("/config"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.uncertain, false);
      assert.equal(error.message.includes("委託"), false);
      return true;
    });
  } finally { globalThis.fetch = previous; }
});
