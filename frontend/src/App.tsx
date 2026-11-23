import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useIsFetching,
  useIsMutating,
  useQuery,
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
      await new Promise((resolve) => setTimeout(resolve, 650));
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
  const instruments = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const i of [
      ...config.symbols,
      ...picked,
    ])
      map.set(i.symbol, { ...map.get(i.symbol), ...i });
    return [...map.values()];
  }, [config.symbols, picked]);
  const current =
    instruments.find((i) => i.symbol === selected.symbol) || selected;
  const select = (item: Instrument) => {
    setSelected(item);
    setPicked((previous) =>
      [item, ...previous.filter((i) => i.symbol !== item.symbol)].slice(0, 8),
    );
    setDirty(false);
  };
  const history = useInfiniteQuery({
    queryKey: ["history", current.symbol],
    queryFn: ({ pageParam, signal }) =>
      marketApi<History>(
        "/history/" + current.symbol + "?months=3&offset=" + pageParam,
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (_last, pages) =>
      pages.length * 3 < 120 ? pages.length * 3 : undefined,
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
  useEffect(() => {
    if (
      bars.length >= 120 ||
      !history.hasNextPage ||
      history.isFetching ||
      history.isError
    )
      return;
    const timer = setTimeout(() => void history.fetchNextPage(), 900);
    return () => clearTimeout(timer);
  }, [
    current.symbol,
    bars.length,
    history.hasNextPage,
    history.isFetching,
    history.isError,
  ]);
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
              title={label}
              aria-label={label}
              aria-current={view === key ? "page" : undefined}
              className={`${view === key ? "active" : ""}${!authorized && key !== "trade" ? " locked" : ""}`}
              aria-disabled={!authorized && key !== "trade"}
              onClick={() => chooseView(key)}
            >
              <Icon size={21} />
              <span>{label}</span>
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
            Baglo<span className="product-name">交易終端</span>
          </div>
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
              </span>
              <strong>{money(ledger?.cash)}</strong>
            </div>
            <div>
              <span>可用資金</span>
              <strong>{ledger ? money(ledger.cash - reserved) : "—"}</strong>
            </div>
            <div>
              <span>委託保留</span>
              <strong>{ledger ? money(reserved) : "—"}</strong>
            </div>
            <div>
              <span>持有標的</span>
              <strong>
                {ledger ? holdingCount : "—"} <small>檔</small>
              </strong>
            </div>
            <div>
              <span>待成交委託</span>
              <strong>
                {ledger ? pending.length : "—"} <small>筆</small>
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
                  <strong>{money(current.price)}</strong>
                  <small>最近收盤 {current.as_of || "—"}</small>
                </div>
              </div>
              <StockSearch
                selected={current}
                onSelect={select}
                onDirty={setDirty}
                enabled={true}
              />
            </div>
          )}
          <div hidden={view !== "trade"}>
            <div className="terminal-grid">
              <section className="panel watchlist-panel">
                <div className="panel-heading">
                  <h2>標的清單</h2>
                  <span className="caption">收盤參考</span>
                </div>
                <div className="watchlist">
                  {instruments
                    .filter(
                      (i) =>
                        config.symbols.some((s) => s.symbol === i.symbol) ||
                        picked.some((s) => s.symbol === i.symbol),
                    )
                    .map((i) => (
                      <button
                        key={i.symbol}
                        className={
                          i.symbol === current.symbol ? "selected" : ""
                        }
                        onClick={() => select(i)}
                      >
                        <span>
                          <strong>{i.name}</strong>
                          <small>{i.symbol}</small>
                        </span>
                        <b>{money(i.price)}</b>
                      </button>
                    ))}
                </div>
                <div className="watchlist-note">
                  上市櫃普通股
                  <br />
                  不含 ETF、TDR、權證
                  <br />
                  報價時間依各來源列示
                </div>
              </section>
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
          {(view === "backtest" || view === "automation") && (
            <AutoTrading
              enabled={authorized}
              config={config}
              current={current}
              notify={notify}
              onAccepted={() => setReceipt(true)}
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
            <div className="login-transition-mark">
              <LoaderCircle className="spin" size={32} />
            </div>
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
