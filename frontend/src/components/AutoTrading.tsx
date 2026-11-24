import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, pct, money, dateLabel } from "../lib";
import { Button } from "./ui/button";
import { AiTrading } from "./AiTrading";
import { Database, Flame, History, ListChecks, ShieldCheck, Sparkles } from "lucide-react";
import type { Config, Instrument } from "../types";
type Metrics = {
  total_return: number;
  max_drawdown: number;
  trade_count: number;
  fees: number;
  taxes: number;
  slippage: number;
};
type Run = { metrics: Metrics; start_date: string; end_date: string };
type Row = {
  symbol: string;
  status: string;
  error?: string;
  rule?: {
    strategy: string;
    fast: number;
    slow: number;
    lookback: number;
    reason: string;
  };
  validation?: Run;
  benchmark?: Run;
  final_test?: Run;
  score?: number;
  eligible?: boolean;
};
type Job = {
  id: string;
  status: string;
  created_at: string;
  model: string;
  symbols: string[];
  results: Row[];
  selected_symbol?: string;
  selected_symbols?: string[];
  symbol_names?: Record<string, string>;
  skipped?: { symbol: string; reason: string }[];
  screening?: { market_total: number; shortlist_size: number; research_limit?: number; as_of?: string };
  error?: string;
  notes: string[];
};
export function AutoTrading(props: {
  enabled: boolean;
  config: Config;
  current: Instrument;
  notify: (message: string, error?: boolean) => void;
  onAccepted: () => void;
  onWatchlist: (items: Instrument[]) => void;
}) {
  const [details, setDetails] = useState<string | null>(null);
  const report = useQuery({
    queryKey: ["ai-automation"],
    queryFn: ({ signal }) =>
      api<{ job: Job | null; selection_mode: boolean }>("/ai/automation", {
        signal,
      }),
    enabled: props.enabled,
    refetchInterval: (q) =>
      q.state.data?.job &&
      ["queued", "running"].includes(q.state.data.job.status)
        ? 3000
        : 15000,
  });
  const run = useMutation({
    mutationFn: () =>
      api<Job>("/ai/automation/research", { method: "POST", body: "{}" }),
    onSuccess: () => {
      void report.refetch();
      props.notify(
        "AI 策略研究已排入；將使用已儲存候選池，每檔可能呼叫一次模型，本次按鈕不直接下單。",
      );
    },
    onError: (e: Error) => props.notify(e.message, true),
  });
  const job = report.data?.job;
  const selectedKey = (job?.selected_symbols || []).join(",");
  useEffect(() => {
    if (job?.status !== "completed" || !job.selected_symbols?.length) return;
    props.onWatchlist(job.selected_symbols.map((symbol) => ({
      symbol,
      name: job.symbol_names?.[symbol] || symbol,
    })));
  }, [job?.id, job?.status, selectedKey]);
  const busy = !!job && ["queued", "running"].includes(job.status);
  const limit = job?.screening?.research_limit || 12;
  const picked = (job?.selected_symbols || [job?.selected_symbol]).filter(Boolean) as string[];
  const name = (symbol: string) => job?.symbol_names?.[symbol] || "";
  const market = job?.screening?.market_total;
  const steps = [
    { icon: Flame, title: "挑出熱門股", text: `從${market ? ` ${market} 檔` : ""}上市櫃股票中，找出前一天成交最熱絡的 ${job?.screening?.shortlist_size || 40} 檔。` },
    { icon: Database, title: "檢查資料夠不夠", text: `歷史股價不完整的先跳過，只把前 ${limit} 檔交給 AI。` },
    { icon: Sparkles, title: "AI 設計買賣規則", text: "AI 替每檔股票想一套進出場規則，例如均線交叉。" },
    { icon: History, title: "用過去股價測試", text: "拿歷史資料模擬照規則交易，看會賺還是會賠。" },
    { icon: ListChecks, title: "選出最多 3 檔", text: "成績夠好的才留下；都不夠好就不買，保留現金。" },
    { icon: ShieldCheck, title: "下單前再確認", text: "檢查資金、持倉和當天價格，通過才用虛擬資金下單。" },
  ];
  const pipeline = (
    <section className="panel ai-pipeline" aria-label="AI 每天怎麼選股">
      <div className="panel-heading"><h2>AI 每天怎麼選股</h2><span className="health-updated">全程只用虛擬資金</span></div>
      <ol>{steps.map(({ icon: Icon, title, text }, index) => (
        <li key={title}>
          <span className="step-icon"><Icon size={20} /></span>
          <div><strong><span className="step-no">{index + 1}</span>{title}</strong><p>{text}</p></div>
        </li>
      ))}</ol>
    </section>
  );
  const research = (
    <section className="panel automation-research">
      <div className="panel-heading"><h2>AI 選股研究</h2>{job && <span className={`pill ${job.status}`}>{{ queued: "排隊中", running: "研究中", completed: "已完成", failed: "失敗" }[job.status] || job.status}</span>}</div>
      <div className="research-body">
        <p className="research-lead">從全市場找出最多 3 檔，用歷史資料回測。按下按鈕不會直接下單。</p>
        <div className="backtest-actions">
          <Button disabled={!props.enabled || run.isPending || busy} onClick={() => run.mutate()}>
            {run.isPending ? "送出中…" : busy ? "研究進行中…" : "開始 AI 選股與回測"}
          </Button>
          <Button variant="outline" onClick={() => void report.refetch()}>更新狀態</Button>
        </div>
        {run.error && <p className="inline-error">{run.error.message}</p>}
        {report.error && <p className="inline-error">{report.error.message}</p>}
        {busy && job && <div className="research-progress" role="status" aria-live="polite">
          <span className="health-meter"><i className={`fill-${Math.min(10, Math.round((job.results.length / limit) * 10))}`} /></span>
          <span>已研究 {job.results.length} / {limit} 檔，可以先離開頁面</span>
        </div>}
        {!job && !report.isPending && !report.error && <p className="empty">還沒有研究結果。</p>}
        {job && !busy && <div className="research-outcome">
          <span className="health-label">{dateLabel(job.created_at)} 的結果</span>
          {job.status === "completed" ? picked.length
            ? <div className="picked">{picked.map((symbol) => <span key={symbol} className="picked-chip"><strong>{symbol}</strong>{name(symbol)}</span>)}</div>
            : <strong className="research-cash">保留現金：沒有股票通過門檻</strong>
            : <strong className="research-cash">本次研究未完成</strong>}
          {job.error && <p className="inline-error">{job.error}</p>}
          {job.skipped?.length ? <p className="muted">略過 {job.skipped.length} 檔歷史資料不足的股票</p> : null}
        </div>}
        {!report.data?.selection_mode && <p className="research-hint">先儲存左側設定，才會切換成「回測選股後交易」模式。</p>}
      </div>
    </section>
  );
  const results = job && job.results.length > 0 ? (
    <section className="panel ai-results">
      <div className="panel-heading"><h2>回測結果</h2><span className="health-updated">{job.model}{job.screening?.as_of ? `，資料日 ${job.screening.as_of}` : ""}</span></div>
      <div className="automation-table-scroll">
        <table>
          <thead><tr><th>股票</th><th>AI 策略</th><th>驗證報酬</th><th>最大回撤</th><th>買入持有</th><th>評分</th><th>結果</th></tr></thead>
          <tbody>
            {job.results.map((row) => (
              <tr key={row.symbol} className={details === row.symbol ? "selected" : ""}>
                <td><Button variant="ghost" size="sm" onClick={() => setDetails(details === row.symbol ? null : row.symbol)}>{row.symbol} {name(row.symbol)}</Button></td>
                <td>{row.rule?.strategy === "sma" ? `均線 ${row.rule.fast}/${row.rule.slow}` : row.rule ? `突破 ${row.rule.lookback} 日` : "—"}</td>
                <td className={row.validation ? (row.validation.metrics.total_return >= 0 ? "up" : "down") : ""}>{row.validation ? pct(row.validation.metrics.total_return) : "—"}</td>
                <td>{row.validation ? pct(row.validation.metrics.max_drawdown) : "—"}</td>
                <td>{row.benchmark ? pct(row.benchmark.metrics.total_return) : "—"}</td>
                <td>{row.score?.toFixed(2) ?? "—"}</td>
                <td>{row.status === "failed" ? <span className="pill failed">{row.error || "失敗"}</span> : row.eligible ? <span className="pill completed">符合條件</span> : <span className="pill">未達門檻</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {job.results.filter((r) => r.symbol === details).map((row) => (
        <div className="result-detail" key={row.symbol}>
          <h3>{row.symbol} {name(row.symbol)} 的策略理由</h3>
          <p>{row.rule?.reason || row.error}</p>
          {row.validation && <p className="muted">驗證區間 {row.validation.start_date}～{row.validation.end_date}，交易 {row.validation.metrics.trade_count} 筆；手續費 {money(row.validation.metrics.fees)}、稅 {money(row.validation.metrics.taxes)}、滑價 {money(row.validation.metrics.slippage)}。</p>}
          {row.final_test && <p className="muted">保留測試區間 {row.final_test.start_date}～{row.final_test.end_date}：報酬 {pct(row.final_test.metrics.total_return)}，回撤 {pct(row.final_test.metrics.max_drawdown)}（未用於排名）。</p>}
        </div>
      ))}
      {job.notes.length > 0 && <details className="ai-more result-notes"><summary>評分方式與限制</summary>{job.notes.map((note) => <p key={note}>{note}</p>)}</details>}
    </section>
  ) : null;
  return (
    <div className="automation-page ai-page">
      <header className="automation-header">
        <div><h1>AI 自動交易</h1><p>AI 找股票、回測驗證，通過條件才用虛擬資金下單。</p></div>
      </header>
      <AiTrading {...props} pipeline={pipeline} research={research} results={results} />
    </div>
  );
}
