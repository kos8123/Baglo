import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useIsFetching,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ChartCandlestick,
  ClipboardList,
  FlaskConical,
  LogIn,
  LogOut,
  LockKeyhole,
  LoaderCircle,
  Wallet,
  X,
  ArrowRight,
  RefreshCw,
  BriefcaseBusiness,
  Eye,
  EyeOff,
  Star,
} from "lucide-react";
import { api, dateLabel, initialize, login, logout, marketApi, money, pct } from "./lib";
import type {
  Account,
  Config,
  History,
  Instrument,
  Research as ResearchData,
} from "./types";
import { Button } from "./components/ui/button";
import { StockSearch } from "./components/StockSearch";
import { PriceChart } from "./components/PriceChart";
import { OrderTicket } from "./components/OrderTicket";
import { Orders, Positions } from "./components/Orders";
import { Portfolio } from "./components/Portfolio";
import { AutoTrading } from "./components/AutoTrading";
import { Research } from "./components/Research";
import { Watchlist } from "./components/Watchlist";
import { readLanguage, tr, type Language } from "./language";
export default function App() {
  const init = useQuery({
    queryKey: ["bootstrap"],
    queryFn: initialize,
    staleTime: Infinity,
  });
  return init.data ? (
    <Terminal config={init.data} />
  ) : (
    <div className="startup">
      <div className="wordmark">
        <span>b.</span>Baglo
      </div>
      <h1>{init.error ? "無法連接服務" : "載入交易工作台"}</h1>
      {!init.error && <LoaderCircle className="spin" size={24} />}
      <p>{init.error?.message || "正在讀取設定與帳戶狀態…"}</p>
      {init.error && (
        <Button onClick={() => void init.refetch()}>重新連線</Button>
      )}
    </div>
  );
}
function Terminal({ config }: { config: Config }) {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const changeLanguage = () => {
    const next = language === "en" ? "zh-TW" : "en";
    localStorage.setItem("baglo_language", next);
    document.documentElement.lang = next;
    setLanguage(next);
  };
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const [authorized, setAuthorized] = useState(
      config.environment === "local" || !!sessionStorage.getItem("baglo_token"),
    ),
    [selected, setSelected] = useState<Instrument>(config.symbols[0]),
    [view, setView] = useState(() => {
      const hash = location.hash.slice(1);
      const value = ["ai", "backtest"].includes(hash) ? "automation" : hash;
      return [
        "trade",
        "positions",
        "watchlist",
        "orders",
        "research",
        "ai",
        "automation",
        "backtest",
      ].includes(value)
        ? value
        : "trade";
    }),
    [bottom, setBottom] = useState("positions"),
    [dirty, setDirty] = useState(false),
    [picked, setPicked] = useState<Instrument[]>([]),
    [showFunds, setShowFunds] = useState(() => localStorage.getItem("baglo_show_funds") === "1"),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [receipt, setReceipt] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    location.hash = view;
  }, [view]);
  useEffect(() => {
    const sync = () => {
      const hash = location.hash.slice(1);
      const value = ["ai", "backtest"].includes(hash) ? "automation" : hash;
      if (
        [
          "trade",
          "positions",
          "watchlist",
          "orders",
          "research",
          "ai",
          "automation",
          "backtest",
        ].includes(value)
      ) {
        if (!authorized && value !== "trade") setView("trade");
        else setView(value);
      }
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [authorized]);
  const notify = (message: string, error = false) =>
    setToast({ message, error });
  const chooseView = (next: string) => {
    if (!authorized && next !== "trade") {
      notify("請先登入或建立帳戶，再使用模擬下單、持倉、AI 與回測功能。", true);
      return;
    }
    setView(next);
  };
  const beginLogin = async () => {
    setSigningIn(true);
    try {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 150 : 2400));
      await login(config);
    } catch (error) {
      setSigningIn(false);
      notify(error instanceof Error ? error.message : "無法開啟登入", true);
    }
  };
  useEffect(() => {
    if (!authorized && view !== "trade") setView("trade");
  }, [authorized, view]);
  useEffect(() => {
    const expire = () => {
      setAuthorized(false);
      notify("登入已失效，請重新登入", true);
    };
    window.addEventListener("baglo-unauthorized", expire);
    return () => window.removeEventListener("baglo-unauthorized", expire);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const account = useQuery({
    queryKey: ["account"],
    queryFn: ({ signal }) => api<Account>("/account", { signal }),
    enabled: authorized,
  });
  const watchlist = useQuery({
    queryKey: ["watchlist"],
    queryFn: ({ signal }) => api<{ items: Instrument[]; symbols: string[] }>("/watchlist", { signal }),
    enabled: authorized,
  });
  const publicPrices = useQuery({
    queryKey: ["public-reference-prices"],
    queryFn: ({ signal }) => api<{ items: Instrument[] }>("/instruments", { signal }),
    enabled: !authorized,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const savedInstruments = authorized
    ? watchlist.data?.items || config.symbols
    : config.symbols.map((item) => ({
        ...item,
        ...publicPrices.data?.items.find((quote) => quote.symbol === item.symbol),
      }));
  const saveWatchlist = useMutation({
    mutationFn: (items: Instrument[]) =>
      api<{ symbols: string[] }>("/watchlist", {
        method: "PUT",
        body: JSON.stringify({ symbols: items.map((item) => item.symbol) }),
      }),
    // Optimistic: show the new list at once and keep it while the server confirms,
    // so the star button and list never fall back to the old state mid-save.
    onMutate: async (items: Instrument[]) => {
      await queryClient.cancelQueries({ queryKey: ["watchlist"] });
      const previous = queryClient.getQueryData<{ items: Instrument[]; symbols: string[] }>(["watchlist"]);
      queryClient.setQueryData(["watchlist"], { items, symbols: items.map((item) => item.symbol) });
      return { previous };
    },
    onSuccess: () => setPicked([]),
    onError: (error: Error, _items, context) => {
      if (context?.previous) queryClient.setQueryData(["watchlist"], context.previous);
      setPicked([]);
      notify(error.message, true);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["account"] });
    },
  });
  const instruments = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const i of [
      ...savedInstruments,
      ...picked,
      selected,
    ])
      map.set(i.symbol, { ...map.get(i.symbol), ...i });
    return [...map.values()];
  }, [savedInstruments, picked, selected]);
  const selectedReference = useQuery({
    queryKey: ["reference-price", selected.symbol],
    queryFn: ({ signal }) => api<{ items: Instrument[] }>("/instruments?q=" + encodeURIComponent(selected.symbol), { signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const listed =
    instruments.find((i) => i.symbol === selected.symbol) || selected;
  const refreshed = selectedReference.data?.items.find(item => item.symbol === selected.symbol);
  const current = refreshed && (!listed.as_of || (refreshed.as_of || "") >= listed.as_of)
    ? { ...listed, ...refreshed }
    : listed;
  const watchItems = savedInstruments;
  const select = (item: Instrument) => {
    setSelected(item);
    setDirty(false);
  };
  const remember = (items: Instrument[]) => {
    const map = new Map(savedInstruments.map((item) => [item.symbol, item]));
    if (items.every((item) => map.has(item.symbol))) return;
    for (const item of items) map.set(item.symbol, { ...map.get(item.symbol), ...item });
    const next = [...map.values()].slice(-30);
    setPicked(next);
    saveWatchlist.mutate(next);
  };
  const toggleCurrentWatch = () => {
    if (!authorized) return void beginLogin();
    if (saveWatchlist.isPending) return;
    const exists = savedInstruments.some((item) => item.symbol === current.symbol);
    const next = exists
      ? savedInstruments.filter((item) => item.symbol !== current.symbol)
      : [...savedInstruments, current];
    setPicked(next);
    saveWatchlist.mutate(next);
  };
  const history = useInfiniteQuery({
    queryKey: ["history", current.symbol],
    queryFn: ({ pageParam, signal }) =>
      marketApi<History>(
        "/history/" + current.symbol + "?months=120&offset=" + pageParam,
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: () => undefined,
    enabled: true,
    staleTime: 6 * 3600000,
    gcTime: 30 * 60000,
  });
  const bars = useMemo(() => {
    const map = new Map();
    for (const page of history.data?.pages || [])
      for (const bar of page.bars) map.set(bar.date, bar);
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [history.data]);
  // A newer completed daily bar may be available before the quote catalog refreshes.
  const taipei = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const lastCompletedBar = bars.filter(bar => bar.date < taipei).at(-1);
  const closeReference = lastCompletedBar && (!current.as_of || lastCompletedBar.date > current.as_of)
    ? { price: lastCompletedBar.close, date: lastCompletedBar.date, source: history.data?.pages[0].source || "日 K 資料" }
    : { price: current.price, date: current.as_of, source: current.source || current.exchange || "行情來源" };
  const research = useQuery({
    queryKey: ["research", current.symbol],
    queryFn: ({ signal }) =>
      api<ResearchData>("/research/" + current.symbol, { signal }),
    enabled: authorized,
    staleTime: 6 * 3600000,
  });
  const ledger = authorized ? account.data : undefined,
    pending = ledger?.orders.filter((o) => o.status === "pending") || [],
    reserved = pending
      .filter((o) => o.side === "buy")
      .reduce((s, o) => s + o.reserved, 0),
    holdingCount = Object.values(ledger?.positions || {}).filter(
      (q) => q > 0,
    ).length;
  const range = bars.length
    ? `${bars[0].date} ～ ${bars.at(-1)!.date} · ${bars.length} 個交易日`
    : "";
  const nav = [
    { key: "trade", label: "交易工作台", icon: ChartCandlestick },
    { key: "watchlist", label: "我的自選股", icon: Star },
    { key: "research", label: "個股研究", icon: FlaskConical },
    { key: "positions", label: "我的持倉", icon: BriefcaseBusiness },
    { key: "orders", label: "委託紀錄", icon: ClipboardList },
    { key: "automation", label: "AI 自動交易", icon: Activity },
  ];
  return (
    <div className="app-shell">
      <aside className="app-rail">
        <a href="/" className="rail-logo" aria-label="Baglo 首頁">
          b.
        </a>
        <nav>
          {nav.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              title={tr(label, language)}
              aria-label={tr(label, language)}
              aria-current={view === key ? "page" : undefined}
              className={`${view === key ? "active" : ""}${!authorized && key !== "trade" ? " locked" : ""}`}
              aria-disabled={!authorized && key !== "trade"}
              onClick={() => chooseView(key)}
            >
              <Icon size={21} />
              <span>{tr(label, language)}</span>
              {!authorized && key !== "trade" && (
                <LockKeyhole className="nav-lock" size={12} />
              )}
            </button>
          ))}
        </nav>
        <span className="rail-bottom">TW</span>
      </aside>
      <div className="application">
        <header className="topbar">
          <div className="wordmark">
            Baglo<span className="product-name">{tr("交易終端", language)}</span>
          </div>
          <button type="button" role="switch" aria-checked={language === "en"} className="lang-switch" onClick={changeLanguage} aria-label="Switch language / 切換語言"><span className="lang-knob" aria-hidden="true" /><span className="lang-opt">中</span><span className="lang-opt">EN</span></button>
          <div className="connection">
            <i />
            {config.demo
              ? "本機沙盒"
              : config.environment === "local"
                ? "本機模擬"
                : "PAPER / " + config.environment.toUpperCase()}
          </div>
          {(fetching > 0 || mutating > 0) && (
            <div className="global-loading" role="status" aria-live="polite">
              <LoaderCircle className="spin" size={15} />
              <span>載入中</span>
            </div>
          )}
          {config.environment !== "local" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (authorized) logout(config);
                else void beginLogin();
              }}
            >
              {authorized ? <LogOut size={15} /> : <LogIn size={15} />}
              <span>{authorized ? "登出" : "登入"}</span>
            </Button>
          )}
        </header>
        <main>
          <div className="account-strip">
            <div>
              <span>
                <Wallet size={13} /> 現金餘額
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={showFunds ? "隱藏帳務摘要" : "顯示帳務摘要"}
                  aria-pressed={showFunds}
                  onClick={() => {
                    const next = !showFunds;
                    setShowFunds(next);
                    localStorage.setItem("baglo_show_funds", next ? "1" : "0");
                  }}
                >
                  {showFunds ? <Eye size={13} /> : <EyeOff size={13} />}
                </Button>
              </span>
              <strong>{showFunds ? money(ledger?.cash) : "****"}</strong>
            </div>
            <div>
              <span>可用資金</span>
              <strong>{showFunds ? (ledger ? money(ledger.cash - reserved) : "—") : "****"}</strong>
            </div>
            <div>
              <span>委託保留</span>
              <strong>{showFunds ? (ledger ? money(reserved) : "—") : "****"}</strong>
            </div>
            <div>
              <span>持有標的</span>
              <strong>
                {showFunds ? (ledger ? holdingCount : "—") : "****"} {showFunds && <small>檔</small>}
              </strong>
            </div>
            <div>
              <span>待成交委託</span>
              <strong>
                {showFunds ? (ledger ? pending.length : "—") : "****"} {showFunds && <small>筆</small>}
              </strong>
            </div>
          </div>
          <div className="simulation-note">
            <Activity size={13} />
            <span>
              {config.demo
                ? "純模擬帳戶・真實行情參考・沙盒成交僅依委託限價示範"
                : "純模擬帳戶・委託不自動撮合"}
              <b> AI 設定與執行紀錄請至左側專區</b>
            </span>
          </div>
          {!authorized && (
            <div className="notice">
              <span>訪客可查看股價與 K 線；登入或建立帳戶後，可使用模擬下單、持倉、AI 與回測。</span>
              <Button
                size="sm"
                onClick={() =>
                  void beginLogin()
                }
              >
                登入／建立帳戶
              </Button>
            </div>
          )}
          {account.error && authorized && (
            <div className="error-banner">
              {account.error.message}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void account.refetch()}
              >
                重試
              </Button>
            </div>
          )}
          {["trade", "research"].includes(view) && (
            <div className="symbol-bar">
              <div className="symbol-heading">
                <span className="market-tag">
                  {current.exchange === "TPEx" ? "TPEx" : "TWSE"}
                </span>
                <h1>
                  {current.symbol} <span>{current.name}</span>
                </h1>
                <div className="daily-close">
                  <strong>{money(closeReference.price)}</strong>
                  <small>{selectedReference.isPending && !closeReference.date ? "讀取收盤資料…" : `收盤資料日 ${closeReference.date || "尚未取得"}`}</small>
                  {closeReference.date && <small>{closeReference.source} · {closeReference.date < taipei ? "歷史收盤參考，非即時行情" : "依來源提供日期"}</small>}
                  <Button variant="ghost" size="sm" disabled={selectedReference.isFetching} onClick={() => void selectedReference.refetch()}>{selectedReference.isFetching ? "更新中…" : "更新參考價"}</Button>
                  {current.stale_cache && <small role="status">來源暫未更新，顯示舊快取</small>}
                  {selectedReference.error && <small role="status">更新失敗，保留原資料日期</small>}
                </div>
              </div>
              <StockSearch
                selected={current}
                onSelect={select}
                onDirty={setDirty}
                enabled={true}
              />
              <Button
                variant={watchItems.some((item) => item.symbol === current.symbol) ? "default" : "outline"}
                size="sm"
                aria-busy={saveWatchlist.isPending}
                onClick={toggleCurrentWatch}
              >
                <Star size={14} />
                {watchItems.some((item) => item.symbol === current.symbol) ? "移除自選" : "加入自選"}
              </Button>
            </div>
          )}
          <div hidden={view !== "trade"}>
            <div className="terminal-grid">
              <details className="panel watchlist-panel trading-watchlist" open>
                <summary className="panel-heading">
                  <span><Star size={14} /> {authorized ? "我的自選股" : "訪客觀察清單"} · {watchItems.length} 檔</span>
                  <span className="caption">點此展開／收合</span>
                </summary>
                <div className="watchlist">
                  {!authorized && publicPrices.isPending && <p className="empty" role="status"><LoaderCircle className="spin" size={16} /> 正在讀取收盤參考價…</p>}
                  {!authorized && publicPrices.error && <div className="notice" role="alert"><span>收盤參考價暫時無法載入</span><Button size="sm" variant="outline" onClick={() => void publicPrices.refetch()}>重試</Button></div>}
                  {watchItems.map((i) => (
                      <button
                        key={i.symbol}
                        className={
                          i.symbol === current.symbol ? "selected" : ""
                        }
                        onClick={() => { select(i); setView("trade"); }}
                      >
                        <span>
                          <strong>{i.name}</strong>
                          <small>{i.symbol}</small>
                        </span>
                        <b>{money(i.price)}</b>
                      </button>
                    ))}
                  {!watchItems.length && <p className="empty">尚無自選股，請先搜尋股票後加入。</p>}
                </div>
                <div className="watchlist-note">
                  <span>{authorized ? "與「我的自選股」同步，點選股票切換 K 線與下單標的。" : "登入後可保存自己的自選股。"} 價格為收盤參考。</span>
                  {authorized && <Button variant="ghost" size="sm" onClick={() => chooseView("watchlist")}>管理自選股</Button>}
                </div>
              </details>
              <div className="center-column">
                <section className="panel chart-card">
                  <div className="panel-heading">
                    <h2>
                      {current.name} <small>{current.symbol}</small>
                    </h2>
                    <span className="badge">
                      {history.data?.pages[0].source || "官方資料"} · OHLCV
                    </span>
                  </div>
                  <PriceChart
                    key={current.symbol}
                    symbol={current.symbol}
                    bars={bars}
                    loading={history.isPending}
                    error={history.error?.message}
                    range={range}
                    onOlder={() => void history.fetchNextPage()}
                    canOlder={!!history.hasNextPage}
                    olderLoading={history.isFetchingNextPage}
                    warnings={
                      !!history.data?.pages.some((p) => p.warnings.length > 0)
                    }
                  />
                  <div className="indicator-strip">
                    <div>
                      <span>SMA20</span>
                      <strong>{money(history.data?.pages[0].sma20)}</strong>
                    </div>
                    <div>
                      <span>營收年增率</span>
                      <strong>
                        {pct(research.data?.fundamentals.revenue?.yoy_percent)}
                      </strong>
                    </div>
                    <div>
                      <span>三大法人淨買賣</span>
                      <strong>
                        {research.data?.ownership.total_net_shares == null
                          ? "—"
                          : research.data.ownership.total_net_shares.toLocaleString() +
                            " 股"}
                      </strong>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => chooseView("research")}
                    >
                      研究 <ArrowRight size={13} />
                    </Button>
                  </div>
                </section>
                <section className="panel portfolio-panel">
                  <div className="panel-tabs">
                    <Button
                      variant="ghost"
                      className={bottom === "positions" ? "active" : ""}
                      onClick={() => setBottom("positions")}
                    >
                      庫存持倉 <small>{holdingCount}</small>
                    </Button>
                    <Button
                      variant="ghost"
                      className={bottom === "orders" ? "active" : ""}
                      onClick={() => setBottom("orders")}
                    >
                      委託紀錄 <small>{ledger?.orders.length || 0}</small>
                    </Button>
                  </div>
                  {bottom === "positions" ? (
                    <Positions
                      account={ledger}
                      instruments={instruments}
                      onSelect={select}
                    />
                  ) : (
                    <Orders account={ledger} config={config} notify={notify} />
                  )}
                </section>
              </div>
              <OrderTicket
                key={current.symbol}
                selected={current}
                config={config}
                account={ledger}
                enabled={authorized}
                searchDirty={dirty}
                notify={notify}
                onAccepted={() => setReceipt(true)}
              />
            </div>
          </div>
          {view === "watchlist" && authorized && <Watchlist items={watchItems} current={current} positions={ledger?.positions || {}} saving={saveWatchlist.isPending} onSave={items => { setPicked(items); saveWatchlist.mutate(items); }} onOpen={item => { select(item); setView("trade"); }} notify={notify} />}
          {(view === "backtest" || view === "automation") && (
            <AutoTrading
              enabled={authorized}
              config={config}
              current={current}
              notify={notify}
              onAccepted={() => setReceipt(true)}
              onWatchlist={remember}
            />
          )}
          {view === "positions" && (
            <Portfolio
              enabled={authorized}
              onSelect={(item) => {
                select(item);
                setView("trade");
              }}
            />
          )}
          {view === "research" && (
            <Research
              data={research.data}
              history={history.data?.pages[0]}
              error={research.error?.message}
              loading={research.isFetching}
            />
          )}
          {view === "orders" && (
            <section className="panel activity-panel">
              <div className="panel-heading">
                <h2>委託紀錄</h2>
                <span className="badge">PAPER ACCOUNT</span>
              </div>
              <Orders account={ledger} config={config} notify={notify} />
            </section>
          )}
          <footer>
            <span>
              Baglo · Taiwan Equities
              <br />
              <a
                href="https://www.tradingview.com/"
                target="_blank"
                rel="noreferrer"
              >
                TradingView Lightweight Charts™
              </a>{" "}
              ·{" "}
              <a
                href="/third-party-notices.txt"
                target="_blank"
                rel="noreferrer"
              >
                Copyright (с) 2025 TradingView, Inc.
              </a>{" "}
              · <a href="/">關於 Baglo</a>{" "}
              · <a href="/privacy.html">隱私權政策</a>{" "}
              · <a href="/terms.html">服務條款</a>
            </span>
            <span>純模擬交易・初始虛擬本金 300,000 元・不提供真實委託</span>
          </footer>
        </main>
        {toast && (
          <div
            className={"toast " + (toast.error ? "toast-error" : "")}
            role={toast.error ? "alert" : "status"}
          >
            <span>{toast.message}</span>
            <button aria-label="關閉通知" onClick={() => setToast(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {signingIn && (
          <div className="login-transition" role="status" aria-live="polite">
            <svg className="baglo-login-animation" viewBox="0 0 340 130" aria-hidden="true">
              <text className="baglo-letter-b" x="10" y="98">b</text>
              <text className="baglo-letter baglo-letter-a" x="78" y="98">a</text>
              <text className="baglo-letter baglo-letter-g" x="140" y="98">g</text>
              <g className="baglo-letter baglo-letter-l baglo-candle-letter">
                <line x1="221" y1="21" x2="221" y2="108" />
                <rect x="214" y="37" width="14" height="61" rx="2" />
              </g>
              <circle className="baglo-travel-dot" cx="78" cy="90" r="7" />
              <circle className="baglo-drawn-o" cx="282" cy="72" r="26" pathLength="1" />
            </svg>
            <strong>正在開啟安全登入</strong>
            <span>登入後才會啟用個人交易與 AI 功能</span>
          </div>
        )}
        {receipt && (
          <div className="receipt" role="status">
            <ClipboardList size={18} />
            <div>
              <strong>模擬委託已送出</strong>
              <p>委託不代表成交，請查看處理狀態。</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setView("orders");
                setReceipt(false);
              }}
            >
              委託紀錄 <ArrowRight size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="關閉委託提醒"
              onClick={() => setReceipt(false)}
            >
              <X size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
