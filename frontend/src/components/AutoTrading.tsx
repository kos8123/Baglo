import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, pct, money, dateLabel } from "../lib";
import { Button } from "./ui/button";
import { AiTrading } from "./AiTrading";
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
  return (
    <div className="automation-page">
      <header className="automation-header">
        <div>
          <h1>AI 自動交易</h1>
          <p>先找出值得研究的股票，再用歷史資料驗證，最後依你的設定建立模擬委託。</p>
        </div>
        <span className="badge">PAPER TRADING</span>
      </header>
      <ol className="automation-guide" aria-label="AI 模擬交易操作流程">
        <li><strong>1. 設定交易條件</strong><span>填寫每筆預算與最低信心分數，儲存設定。</span></li>
        <li><strong>2. 開始選股研究</strong><span>AI 產生策略並回測；你可以離開頁面，稍後回來查看。</span></li>
        <li><strong>3. 查看候選與委託</strong><span>通過條件才會成為候選；啟用且排程就緒後才自動建立委託。</span></li>
      </ol>
      <AiTrading {...props} />
      <section className="panel automation-research">
        <div className="panel-heading">
          <h2>策略回測與選股</h2>
          <span className="badge">僅限模擬</span>
        </div>
        <p className="panel-footnote">
          全市場流動性初篩 → AI 產生策略 → 凍結規則 → 回測與驗證排名 → 選股或保留現金 →
          當日技術／基本／籌碼分析 → 風控 → 模擬委託。
        </p>
        <div className="notice">
          系統先從全市場選出 40 檔流動性候選，再略過歷史資料不足的股票；只將前 12
          檔資料完整的股票交給模型，最多選出 3 檔。啟用每日模式後不逐筆要求確認；所有委託僅存在模擬帳本。
        </div>
        <div className="backtest-actions">
          <Button
            disabled={!props.enabled || run.isPending || busy}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "正在送出研究…" : busy ? "研究進行中，請稍候…" : "開始 AI 選股與回測"}
          </Button>
          <Button variant="outline" onClick={() => void report.refetch()}>
            更新研究狀態
          </Button>
        </div>
        {run.error && <p className="inline-error">{run.error.message}</p>}
        {report.error && <p className="inline-error">{report.error.message}</p>}
        {!job && !report.isPending && !report.error && <p className="empty">還沒有選股報告。點選「開始 AI 選股與回測」，完成後會在這裡顯示候選股票、策略理由與回測表現。</p>}
        {busy && <div className="notice" role="status" aria-live="polite">已完成 {job.results.length} 檔研究，最多研究 {job.screening?.research_limit || 12} 檔。系統會自動更新進度，不需要重複點擊。</div>}
        {job && (
          <>
            <p className="panel-footnote">
              {dateLabel(job.created_at)} · {job.model} ·{" "}
              {{
                queued: "排隊中",
                running: "研究中",
                completed: "研究完成",
                failed: "研究失敗",
              }[job.status] || job.status}{" "}
              · 有效研究 {job.results.length}/{job.screening?.research_limit || 12} 檔
              {job.skipped?.length ? ` · 已略過 ${job.skipped.length} 檔資料不足股票` : ""}
            </p>
            <h2>
              {job.status === "completed"
                ? job.selected_symbols?.length || job.selected_symbol
                  ? `本次選中 ${(job.selected_symbols || [job.selected_symbol]).filter(Boolean).map((symbol) => `${symbol} ${job.symbol_names?.[symbol!] || ""}`.trim()).join("、")}`
                  : "本次保留現金：沒有標的通過驗證門檻"
                : "研究期間不新增自動委託"}
            </h2>
            {job.error && <p className="inline-error">{job.error}</p>}
            {job.screening && (
              <p className="panel-footnote">
                全市場 {job.screening.market_total} 檔 → 流動性初篩 {job.screening.shortlist_size} 檔 → 完整歷史研究最多 {job.screening.research_limit || 12} 檔
                {job.screening.as_of ? ` · 資料日 ${job.screening.as_of}` : ""}
              </p>
            )}
            <div className="automation-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>股票</th>
                    <th>AI 策略</th>
                    <th>驗證報酬</th>
                    <th>最大回撤</th>
                    <th>買入持有</th>
                    <th>評分</th>
                    <th>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {job.results.map((row) => (
                    <tr key={row.symbol}>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDetails(
                              details === row.symbol ? null : row.symbol,
                            )
                          }
                        >
                          {row.symbol} {job.symbol_names?.[row.symbol] || ""}
                        </Button>
                      </td>
                      <td>
                        {row.rule?.strategy === "sma"
                          ? `均線 ${row.rule.fast}/${row.rule.slow}`
                          : row.rule
                            ? `突破 ${row.rule.lookback} 日`
                            : "—"}
                      </td>
                      <td>
                        {row.validation
                          ? pct(row.validation.metrics.total_return)
                          : "—"}
                      </td>
                      <td>
                        {row.validation
                          ? pct(row.validation.metrics.max_drawdown)
                          : "—"}
                      </td>
                      <td>
                        {row.benchmark
                          ? pct(row.benchmark.metrics.total_return)
                          : "—"}
                      </td>
                      <td>{row.score?.toFixed(2) ?? "—"}</td>
                      <td>
                        {row.status === "failed"
                          ? row.error
                          : row.eligible
                            ? "符合條件"
                            : "未達門檻"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {job.results
              .filter((r) => r.symbol === details)
              .map((row) => (
                <div className="notice" key={row.symbol}>
                  <div>
                    <h3>{row.symbol} {job.symbol_names?.[row.symbol] || ""} · AI 策略理由</h3>
                    <p>{row.rule?.reason || row.error}</p>
                    {row.validation && (
                      <p>
                        驗證區間 {row.validation.start_date}～
                        {row.validation.end_date}；交易{" "}
                        {row.validation.metrics.trade_count} 筆，手續費{" "}
                        {money(row.validation.metrics.fees)}、稅{" "}
                        {money(row.validation.metrics.taxes)}、滑價影響{" "}
                        {money(row.validation.metrics.slippage)}。
                      </p>
                    )}
                    {row.final_test && (
                      <p>
                        保留測試區間 {row.final_test.start_date}～
                        {row.final_test.end_date}：報酬{" "}
                        {pct(row.final_test.metrics.total_return)}，回撤{" "}
                        {pct(row.final_test.metrics.max_drawdown)}
                        。此區間未用於排名。
                      </p>
                    )}
                  </div>
                </div>
              ))}
            {job.notes.map((note) => (
              <p className="panel-footnote" key={note}>
                {note}
              </p>
            ))}
          </>
        )}
      </section>
      {!report.data?.selection_mode && (
        <p className="notice automation-mode-note">
          請先儲存上方設定，才會切換為「回測選股後交易」模式；啟用與否依勾選結果生效。
        </p>
      )}
    </div>
  );
}
