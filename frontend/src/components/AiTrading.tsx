import { useEffect, useState, type ReactNode } from "react";
import { Bot, CalendarClock, Cpu } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dateLabel, money } from "../lib";
import type { Config, Instrument } from "../types";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
interface Settings {
  enabled: boolean;
  symbols: string[];
  budget: number;
  min_confidence: number;
}
interface Job {
  id: string;
  symbol: string;
  status: string;
  created_at: string;
  data_as_of?: string;
  error?: string;
  execution_note?: string;
  order_id?: string;
  result?: { action: string; confidence: number; reason: string; risk: string };
}
interface Status {
  configured: boolean;
  model: string;
  settings: Settings;
  jobs: Job[];
  schedule_configured: boolean;
  scheduled?: boolean;
  reason: string;
}
export function AiTrading({
  enabled,
  notify,
  onAccepted,
  pipeline,
  research,
  results,
}: {
  pipeline?: ReactNode;
  research?: ReactNode;
  results?: ReactNode;
  enabled: boolean;
  config: Config;
  current: Instrument;
  notify: (message: string, error?: boolean) => void;
  onAccepted: () => void;
}) {
  const client = useQueryClient(),
    [policy, setPolicy] = useState<Settings>({
      enabled: false,
      symbols: ["2330"],
      budget: 1000000,
      min_confidence: 0.7,
    }),
    [confirm, setConfirm] = useState<"enable" | Job | null>(null);
  const status = useQuery({
    queryKey: ["ai"],
    queryFn: ({ signal }) => api<Status>("/ai", { signal }),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => ["queued", "running"].includes(j.status))
        ? 3000
        : q.state.data?.settings.enabled
          ? 15000
          : false,
  });
  const [changed, setChanged] = useState(false);
  const encoded = JSON.stringify(status.data?.settings);
  useEffect(() => {
    if (encoded && !changed) setPolicy(JSON.parse(encoded));
  }, [encoded, changed]);
  const save = useMutation({
    mutationFn: () =>
      api("/ai/automation/settings", {
        method: "PUT",
        body: JSON.stringify(policy),
      }),
    onSuccess: () => {
      client.setQueryData<Status>(["ai"], (old) =>
        old ? { ...old, settings: policy } : old,
      );
      setConfirm(null);
      setChanged(false);
      void client.invalidateQueries({ queryKey: ["ai"] });
      notify("AI 模擬設定已儲存");
    },
    onError: (e: Error) => notify(e.message, true),
  });
  const execute = useMutation({
    mutationFn: (id: string) =>
      api("/ai/jobs/" + id + "/execute", { method: "POST", body: "{}" }),
    onSuccess: () => {
      setConfirm(null);
      void client.invalidateQueries({ queryKey: ["ai"] });
      void client.invalidateQueries({ queryKey: ["account"] });
      void client.invalidateQueries({ queryKey: ["portfolio"] });
      onAccepted();
      notify("AI 建議已建立模擬委託，請至委託紀錄查詢");
    },
    onError: (e: Error) => notify(e.message, true),
  });
  const connection = useMutation({
    mutationFn: () =>
      api<{
        connected: boolean;
        model: string;
        tested_at: string;
        message: string;
      }>("/ai/test", { method: "POST", body: "{}" }),
    onSuccess: (result) => notify(result.message),
    onError: (error: Error) => notify(error.message, true),
  });
  const s = status.data;
  const tiles = [
    { icon: Cpu, label: "AI 模型", value: status.isPending ? "讀取中" : status.error ? "讀取失敗" : s?.configured ? "已連線" : "未設定",
      tone: s?.configured ? "good" : "warn", note: s?.configured ? s.model : "需要設定 Gemini 金鑰" },
    { icon: CalendarClock, label: "每日排程", value: status.isPending ? "讀取中" : s?.schedule_configured ? "已就緒" : "未啟動",
      tone: s?.schedule_configured ? "good" : "neutral", note: s?.schedule_configured ? "平日 08:30 自動開始" : "目前只能手動分析" },
    { icon: Bot, label: "自動委託", value: s?.settings.enabled ? (s.scheduled === false ? "未排入" : "已啟用") : "已關閉",
      tone: s?.settings.enabled ? (s.scheduled === false ? "warn" : "good") : "neutral",
      note: s?.settings.enabled && s.scheduled === false ? "名額已滿，排程不會執行此帳戶" : `每筆預算 ${money(policy.budget)}` },
  ];
  const confidence = Math.round(policy.min_confidence * 100);
  const actionLabel: Record<string, string> = { buy: "買進", sell: "賣出", hold: "觀望" };
  const statusLabel: Record<string, string> = { queued: "排隊中", running: "分析中", completed: "已完成", failed: "失敗" };
  return (
    <>
      <div className="ai-tiles">
        {tiles.map(({ icon: Icon, ...tile }) => (
          <article key={tile.label} className={`ai-tile ${tile.tone}`}>
            <span className="ai-tile-icon"><Icon size={20} /></span>
            <div><span className="ai-tile-label">{tile.label}</span><strong>{tile.value}</strong><p>{tile.note}</p></div>
          </article>
        ))}
      </div>
      {status.error && <div className="inline-error">{status.error.message}</div>}
      {pipeline}
      <div className="ai-columns">
        <section className="panel ai-settings">
          <div className="panel-heading"><h2>交易設定</h2>{changed && <span className="badge">尚未儲存</span>}</div>
          <div className="ai-settings-body">
            <label className="switch-field">
              <span><strong>每天自動模擬下單</strong><small>關閉後立即停止後續自動委託</small></span>
              <input type="checkbox" role="switch" checked={policy.enabled}
                onChange={(e) => (setChanged(true), setPolicy({ ...policy, enabled: e.target.checked }))} />
              <i className="switch-track" aria-hidden="true" />
            </label>
            <label className="field">每筆預算
              <span className="input-suffix">
                <input type="number" min="100" max="300000" value={policy.budget / 100}
                  onChange={(e) => (setChanged(true), setPolicy({ ...policy, budget: Math.round(Number(e.target.value) * 100) }))} />
                <span>元</span>
              </span>
            </label>
            <label className="field range-field">
              <span className="range-head">最低信心門檻<strong>{confidence}%</strong></span>
              <input type="range" min="50" max="100" step="5" value={confidence} aria-describedby="confidence-help"
                onChange={(e) => (setChanged(true), setPolicy({ ...policy, min_confidence: Number(e.target.value) / 100 }))} />
              <span id="confidence-help" className="range-help">AI 把握低於 {confidence}% 就不下單。這不是獲利機率。</span>
            </label>
            <Button disabled={!enabled || save.isPending}
              onClick={() => { if (policy.enabled && !status.data?.settings.enabled) setConfirm("enable"); else save.mutate(); }}>
              {save.isPending ? "儲存中…" : "儲存設定"}
            </Button>
            <ol className="ai-schedule" aria-label="每日排程">
              <li><time>08:30</time>全市場初篩、回測與分析</li>
              <li><time>09:05</time>確認即時行情後送出模擬單</li>
              <li><time>13:00</time>之後不再開始新的選股研究</li>
            </ol>
            <details className="ai-more">
              <summary>規則細節</summary>
              <p>設得高通常交易較少，但不保證比較準或比較賺；達到門檻後仍要通過資金、持倉與行情檢查。AI 分數是否可靠，需要累積建議與結果來驗證。</p>
              <p>不需自行加入股票。系統依前一交易日成交金額、資料新鮮度與極端漲跌條件，從上市櫃普通股先取 40 檔，再略過歷史資料不足者；前 12 檔完整資料才交給 AI，最多選出 3 檔。既有持倉優先納入檢查。</p>
              <p>電腦休眠或服務停止時不會執行。假日、缺資料、觀望或風控不符就跳過，不補造決策。分析會呼叫 Gemini，費用與配額依 Google 專案設定。</p>
            </details>
          </div>
        </section>
        {research}
      </div>
      {results}
      <section className="panel automation-log">
        <div className="panel-heading"><h2>分析與執行紀錄</h2>
          <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>更新</Button></div>
        {!status.data?.jobs.length && <p className="empty">還沒有 AI 分析紀錄。</p>}
        <div className="ai-jobs">
          {status.data?.jobs.slice().reverse().map((job) => (
            <article className="ai-job" key={job.id}>
              <header>
                <strong>{job.symbol}</strong>
                <span className={`pill ${job.status}`}>{statusLabel[job.status] || job.status}</span>
                <time>{dateLabel(job.created_at)}</time>
              </header>
              {job.result && (
                <>
                  <div className="ai-decision">
                    <span className={`pill action-${job.result.action}`}>{actionLabel[job.result.action] || job.result.action}</span>
                    <span className="confidence-meter" aria-label={`信心 ${(job.result.confidence * 100).toFixed(0)}%`}>
                      <i className={`fill-${Math.round(job.result.confidence * 10)}`} />
                    </span>
                    <span className="confidence-value">{(job.result.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="ai-reason">{job.result.reason}</p>
                  <details className="ai-more"><summary>風險與資料日期</summary>
                    <p>{job.result.risk}</p><p>日線截至 {job.data_as_of}</p></details>
                </>
              )}
              {job.error && <p className="inline-error">{job.error}</p>}
              {job.execution_note && <p className="muted">執行結果：{job.execution_note}</p>}
              {job.order_id ? <p className="ai-order">已建立模擬委託 {job.order_id}</p>
                : job.result?.action !== "hold" && job.status === "completed" && (
                  <Button size="sm" disabled={execute.isPending} onClick={() => setConfirm(job)}>採用建議，建立模擬委託</Button>)}
            </article>
          ))}
        </div>
      </section>
      <details className="panel ai-connection-details">
        <summary>進階：模型連線測試</summary>
        <div className="ai-connection">
          <p className="panel-footnote">連線測試會使用少量 Gemini API 額度，不會建立委託。</p>
          <div className="backtest-actions">
            <Button disabled={!enabled || connection.isPending} onClick={() => connection.mutate()}>
              {connection.isPending ? "測試中…" : "測試模型連線"}</Button>
            <Button variant="outline" onClick={() => void status.refetch()}>重新讀取狀態</Button>
          </div>
          {connection.error && <p className="inline-error">{connection.error.message}</p>}
          {connection.data && <p className="panel-footnote">{connection.data.model}，{dateLabel(connection.data.tested_at)}：{connection.data.message}</p>}
        </div>
      </details>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open && !save.isPending && !execute.isPending) setConfirm(null); }}
        title={confirm === "enable" ? "啟用每日 AI 自動模擬？" : "確認採用 AI 建議"}
      >
        <p className="panel-footnote">
          {confirm === "enable"
            ? `每日排程會呼叫模型，可能產生 API 費用。每筆預算 ${money(policy.budget)}，只以虛擬資金建立委託，不會送真單。`
            : "執行器將以當下可信報價與設定預算重新計算股數，通過開市、漲跌停、資金與持倉檢查才建立模擬委託；同一分析不重複下單。"}
        </p>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setConfirm(null)}>返回</Button>
          <Button disabled={save.isPending || execute.isPending}
            onClick={() => { if (confirm === "enable") save.mutate(); else if (confirm) execute.mutate(confirm.id); }}>確認</Button>
        </div>
      </Dialog>
    </>
  );
}
