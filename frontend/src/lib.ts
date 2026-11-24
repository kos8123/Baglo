import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Account, Order, Config } from "./types.ts";
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("zh-TW", {
        style: "currency",
        currency: "TWD",
        maximumFractionDigits: 2,
      }).format(value / 100);
export const pct = (value: number | null | undefined) =>
  value == null ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
export const shares = (value: number) =>
  value >= 1000
    ? `${Math.floor(value / 1000).toLocaleString()} 張${value % 1000 ? " " + (value % 1000) + " 股" : ""}`
    : `${value.toLocaleString()} 股`;
export const dateLabel = (value?: string) => {
  if (!value) return "—";
  if (value.length === 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? value
    : new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Taipei",
      }).format(d);
};
export const tick = (price: number, config: Config) =>
  config.price_ticks.find((b) => b.below === null || price < b.below)!.tick;
export class ApiError extends Error {
  status: number;
  uncertain: boolean;
  constructor(message: string, status: number, uncertain = false) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}
let apiBase = "";
let marketBase = "";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionStorage.getItem("baglo_token");
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(
    (options.method || "GET").toUpperCase(),
  );
  let response: Response;
  try {
    response = await fetch(apiBase + "/api" + path, {
      ...options,
      headers: {
        ...(options.body != null ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...options.headers,
      },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new ApiError(
      mutating
        ? "無法確認伺服器回應，請查詢委託狀態"
        : "無法連線至服務，請確認網路或稍後再試",
      0,
      mutating,
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      mutating
        ? "服務回應無法讀取，請查詢委託狀態"
        : "服務回應無法讀取，請稍後重試",
      response.status,
      mutating,
    );
  }
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem("baglo_token");
      window.dispatchEvent(new Event("baglo-unauthorized"));
    }
    throw new ApiError(
      data.error || "服務暫時無法使用",
      response.status,
      response.status >= 500,
    );
  }
  return data;
}
export async function marketApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!marketBase) return api<T>(path, { signal });
  const response = await fetch(marketBase + path, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || "行情資料暫時無法取得", response.status, response.status >= 500);
  return data;
}
export async function submitPaperOrder(item: {
  key: string;
  payload: string;
}): Promise<Order> {
  try {
    return await api<Order>("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": item.key },
      body: item.payload,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || !error.uncertain) throw error;
    try {
      const snapshot = await api<Account>("/account");
      const accepted = snapshot.orders.find((o) => o.id === item.key);
      if (accepted) return accepted;
    } catch {
      /* Status stays uncertain; never infer failure from a read error. */
    }
    throw new ApiError(
      "未能確認是否已受理，請先至委託紀錄查詢；再次確認會沿用同一請求編號。",
      0,
      true,
    );
  }
}
const b64 = (buffer: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function login(config: Config) {
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32))),
    state = crypto.randomUUID();
  sessionStorage.setItem("baglo_verifier", verifier);
  sessionStorage.setItem("baglo_oauth_state", state);
  const url = new URL(config.auth_domain + "/oauth2/authorize");
  const redirect = new URL(
    location.pathname === "/terminal" || location.pathname.endsWith("/terminal.html")
      ? "/terminal"
      : "/",
    location.origin,
  ).toString();
  url.search = new URLSearchParams({
    client_id: config.client_id,
    response_type: "code",
    lang: "zh-TW",
    scope: "openid baglo-api/access",
    redirect_uri: redirect,
    state,
    code_challenge_method: "S256",
    code_challenge: b64(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  }).toString();
  location.assign(url);
}
export function logout(config: Config) {
  sessionStorage.removeItem("baglo_token");
  if (!config.auth_domain) {
    location.reload();
    return;
  }
  const url = new URL(config.auth_domain + "/logout");
  url.search = new URLSearchParams({
    client_id: config.client_id,
    logout_uri: location.origin + "/",
  }).toString();
  location.assign(url);
}
let bootstrap: Promise<Config> | null = null;
export function initialize() {
  return (bootstrap ??= (async () => {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("無法讀取網站設定");
    const runtime = await response.json();
    apiBase = (runtime.api_base || "").replace(/\/$/, "");
    marketBase = (runtime.market_base || "").replace(/\/$/, "");
    const config = await api<Config>("/config");
    const query = new URLSearchParams(location.search);
    if (query.has("error")) {
      history.replaceState(null, "", location.pathname);
      throw new Error("登入未完成，請重新登入");
    }
    if (query.has("code")) {
      const redirect = new URL(
        location.pathname === "/terminal" || location.pathname.endsWith("/terminal.html")
          ? "/terminal"
          : "/",
        location.origin,
      ).toString();
      const state = sessionStorage.getItem("baglo_oauth_state"),
        verifier = sessionStorage.getItem("baglo_verifier");
      history.replaceState(null, "", location.pathname);
      sessionStorage.removeItem("baglo_oauth_state");
      sessionStorage.removeItem("baglo_verifier");
      if (!state || state !== query.get("state") || !verifier)
        throw new Error("登入驗證已失效");
      const token = await fetch(config.auth_domain + "/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.client_id,
          code: query.get("code")!,
          redirect_uri: redirect,
          code_verifier: verifier,
        }),
      });
      const data = await token.json();
      if (!token.ok || !data.access_token)
        throw new Error("登入失敗，請重新登入");
      sessionStorage.setItem("baglo_token", data.access_token);
    }
    return config;
  })().catch((e) => {
    bootstrap = null;
    throw e;
  }));
}

/** Weekday 09:00–13:35 in Taipei: the window when today's candle keeps changing. */
export function inTradingSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return !["Sat", "Sun"].includes(get("weekday")) && minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
}
