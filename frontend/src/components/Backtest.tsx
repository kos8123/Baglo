import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createChart,
  LineSeries,
  ColorType,
  type Time,
} from "lightweight-charts";
import { api, money, pct } from "../lib";
import type { Instrument, Venue } from "../types";
import { Button } from "./ui/button";
interface Metrics {
  total_return: number;
  annualized_return: number | null;
  max_drawdown: number;
  sharpe: number | null;
  trade_count: number;
  completed_trades: number;
  win_rate: number | null;
  fees: number;
  taxes: number;
  slippage: number;
  turnover: number;
  final_equity: number;
  final_quantity: number;
  skipped_days: number;
}
interface Trade {
  date: string;
  signal_date: string | null;
  side: string;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  slippage: number;
}
interface Run {
  metrics: Metrics;
  curve: { date: string; equity: number }[];
  trades: Trade[];
  start_date: string;
  end_date: string;
}
interface Report {
  strategy: Run;
  benchmark: Run;
  development: Run;
  holdout: Run;
  holdout_benchmark: Run;
  excess_return: number;
  notes: string[];
  warnings: string[];
  data_sha256: string;
  bar_count: number;
}
interface Job {
  id: string;
  status: string;
  error?: string;
  result?: Report;
  request: {
    symbol: string;
    strategy: string;
    start_date: string;
    end_date: string;
    initial_cash: number;
    fast: number;
    slow: number;
    lookback: number;
    slippage_bps: number;
    market_type: Venue;
  };
}
function EquityChart({ report }: { report: Report }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#1c2229" },
        textColor: "#91a5bd",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#ffffff05" },
        horzLines: { color: "#ffffff08" },
      },
      timeScale: { borderColor: "#344457" },
      rightPriceScale: { borderColor: "#344457" },
      localization: { locale: "zh-TW" },
    });
    const strategy = chart.addSeries(LineSeries, {
        color: "#d2f779",
        lineWidth: 2,
        title: "策略",
      }),
      benchmark = chart.addSeries(LineSeries, {
        color: "#7d9dbd",
        lineWidth: 1,
        title: "買入持有",
      });
    strategy.setData(
      report.strategy.curve.map((p) => ({
        time: p.date as Time,
        value: p.equity / 100,
      })),
    );
    benchmark.setData(
      report.benchmark.curve.map((p) => ({
        time: p.date as Time,
        value: p.equity / 100,
      })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [report]);
  return (
    <div
      className="backtest-chart"
      ref={ref}
      role="img"
      aria-label="策略與買入持有的資產曲線"
    />
  );
}
export function Backtest({
  current,
  enabled,
}: {
  current: Instrument;
  enabled: boolean;
}) {
  const iso = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  const today = new Date(),
    yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const [start, setStart] = useState(iso(yearAgo)),
    [end, setEnd] = useState(iso(today)),
    [strategy, setStrategy] = useState("sma"),
    [capital, setCapital] = useState(300000),
    [fast, setFast] = useState(20),
    [slow, setSlow] = useState(60),
    [lookback, setLookback] = useState(20),
    [slippage, setSlippage] = useState(0.1),
    [venue, setVenue] = useState<Venue>("odd_lot"),
    [id, setId] = useState<string | null>(() =>
      sessionStorage.getItem("baglo_last_backtest"),
    ),
    [formError, setFormError] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/backtests", {
        method: "POST",
        body: JSON.stringify({
          symbol: current.symbol,
          strategy,
          start_date: start,
          end_date: end,
          initial_cash: Math.round(capital * 100),
          fast: strategy === "sma" ? fast : 20,
          slow: strategy === "sma" ? slow : 60,
          lookback: strategy === "breakout" ? lookback : 20,
          slippage_bps: Math.round(slippage * 100),
          market_type: venue,
        }),
      }),
    onSuccess: (job) => {
      setId(job.id);
      sessionStorage.setItem("baglo_last_backtest", job.id);
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const job = useQuery({
    queryKey: ["backtest", id],
    queryFn: ({ signal }) => api<Job>("/backtests/" + id, { signal }),
    enabled: !!id,
    refetchInterval: (q) =>
      !q.state.data || ["queued", "running"].includes(q.state.data.status)
        ? 2000
        : false,
  });
  const report = job.data?.result,
    running =
      submit.isPending ||
      job.data?.status === "queued" ||
      job.data?.status === "running";
  const download = () => {
    if (!job.data) return;
    const blob = new Blob([JSON.stringify(job.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "baglo-backtest-" + job.data.id + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const rows: [string, (metrics: Metrics) => string][] = [
    ["總報酬", (m) => pct(m.total_return)],
    ["年化報酬", (m) => pct(m.annualized_return)],
    ["最大回撤", (m) => pct(m.max_drawdown)],
    ["Sharpe", (m) => m.sharpe?.toFixed(2) || "—"],
    ["買賣筆數", (m) => String(m.trade_count)],
    ["已完成來回交易", (m) => String(m.completed_trades)],
    ["勝率（已完成交易）", (m) => pct(m.win_rate)],
    ["手續費", (m) => money(m.fees)],
    ["交易稅", (m) => money(m.taxes)],
    ["滑價成本", (m) => money(m.slippage)],
    ["換手／初始本金", (m) => m.turnover.toFixed(2) + " 倍"],
    ["期末權益", (m) => money(m.final_equity)],
    ["期末持有股數", (m) => m.final_quantity.toLocaleString()],
    ["無量／單價日跳過", (m) => String(m.skipped_days)],
  ];
  return (
    <div className="backtest-workspace">
      <div className="section-title">
        <h1>策略回測</h1>
        <span className="badge">研究用途・不影響模擬帳本</span>
      </div>
      <div className="notice">
        先用歷史資料檢查規則有沒有用，再考慮投入模擬。回測結果不是未來獲利保證；本頁驗證固定規則，不用今天的
        AI 倒填過去的決策，也不能用來宣稱 AI 自評信心等於勝率。
      </div>
      <section className="panel backtest-form">
        <div className="panel-heading">
          <h2>
            {current.symbol} {current.name}
          </h2>
          <span className="caption">使用上方搜尋切換股票</span>
        </div>
        <div className="backtest-fields">
          <label className="field">
            策略
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
            >
              <option value="sma">均線趨勢（短均線高於長均線持有）</option>
              <option value="breakout">突破動能（突破前 N 日高點）</option>
              <option value="buy_hold">買入持有</option>
            </select>
          </label>
          <label className="field">
            起日
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="field">
            迄日
            <input
              type="date"
              max={iso(today)}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label className="field">
            虛擬本金（元）
            <input
              type="number"
              min="1000"
              max="10000000"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
            />
          </label>
          <label className="field">
            交易類別
            <select
              value={venue}
              onChange={(e) => setVenue(e.target.value as Venue)}
            >
              <option value="odd_lot">零股（每次最多 999 股）</option>
              <option value="board_lot">整股（1 張 1,000 股）</option>
            </select>
          </label>
          <label className="field">
            單邊滑價（%）
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
            />
          </label>
          {strategy === "sma" && (
            <>
              <label className="field">
                短均線（日）
                <input
                  type="number"
                  min="2"
                  max="120"
                  value={fast}
                  onChange={(e) => setFast(Number(e.target.value))}
                />
              </label>
              <label className="field">
                長均線（日）
                <input
                  type="number"
                  min="3"
                  max="250"
                  value={slow}
                  onChange={(e) => setSlow(Number(e.target.value))}
                />
              </label>
            </>
          )}
          {strategy === "breakout" && (
            <label className="field">
              突破回看天數
              <input
                type="number"
                min="2"
                max="120"
                value={lookback}
                onChange={(e) => setLookback(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        <p className="panel-footnote">
          均線低於長線時退出；突破策略以收盤跌破 N
          日均線退出。訊號於前日形成、次日開盤加滑價成交；單筆不超過前日成交量
          1%。費率 0.1425%／最低 20 元，股票賣出稅 0.3%。
        </p>
        <div className="backtest-actions">
          <Button
            disabled={!enabled || running}
            onClick={() => {
              setFormError("");
              setId(null);
              submit.mutate();
            }}
          >
            {running ? "歷史資料與回測處理中…" : "開始回測"}
          </Button>
          {id && (
            <Button variant="outline" onClick={() => void job.refetch()}>
              更新狀態
            </Button>
          )}
          {job.data && (
            <Button variant="outline" onClick={download}>
              下載研究結果 JSON
            </Button>
          )}
        </div>
        {(formError || job.error || job.data?.error) && (
          <div className="inline-error" role="alert">
            {formError || job.error?.message || job.data?.error}
          </div>
        )}
      </section>
      {report && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>{job.data?.request.symbol} · 回測資產曲線</h2>
              <span className="caption">綠：策略　藍：買入持有</span>
            </div>
            <p className="panel-footnote">
              實際區間 {report.strategy.start_date} ～{" "}
              {report.strategy.end_date} · 共 {report.bar_count}{" "}
              筆日線（含暖機） · 相對基準 {pct(report.excess_return)}
              。圖表與下表採本次提交時的參數，修改表單不會改寫此結果。
            </p>
            <EquityChart report={report} />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>績效與保留區間比較</h2>
            </div>
            <p className="panel-footnote">
              前 70%：{report.development.start_date} ～{" "}
              {report.development.end_date}；後 30%：{report.holdout.start_date}{" "}
              ～ {report.holdout.end_date}
              。各段獨立以相同本金啟動，參數固定；反覆看結果調參仍可能過度擬合。
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>指標</th>
                    <th>全期策略</th>
                    <th>買入持有</th>
                    <th>前 70% 觀察區</th>
                    <th>後 30% 保留區</th>
                    <th>保留區買入持有</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, format]) => (
                    <tr key={label}>
                      <th>{label}</th>
                      {[
                        report.strategy,
                        report.benchmark,
                        report.development,
                        report.holdout,
                        report.holdout_benchmark,
                      ].map((run, i) => (
                        <td key={i}>{format(run.metrics)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>策略買賣紀錄</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "訊號日",
                      "模擬成交日",
                      "方向",
                      "股數",
                      "成交參考價",
                      "手續費",
                      "稅",
                      "滑價",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.strategy.trades.map((trade, i) => (
                    <tr key={i}>
                      <td>{trade.signal_date || "期初配置"}</td>
                      <td>{trade.date}</td>
                      <td className={trade.side === "buy" ? "up" : "down"}>
                        {trade.side === "buy" ? "買進" : "賣出"}
                      </td>
                      <td>{trade.quantity}</td>
                      <td>{money(trade.price)}</td>
                      <td>{money(trade.fee)}</td>
                      <td>{money(trade.tax)}</td>
                      <td>{money(trade.slippage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.strategy.trades.length && (
                <p className="empty">
                  此區間未產生可成交訊號，或資金／股數條件不足。
                </p>
              )}
            </div>
          </section>
          <section className="panel backtest-notes">
            <h2>結果限制</h2>
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            {report.warnings.length > 0 && (
              <p className="inline-error">
                資料警示：{report.warnings.join("、")}
              </p>
            )}
            <small>資料指紋 SHA-256：{report.data_sha256}</small>
          </section>
        </>
      )}
    </div>
  );
}
