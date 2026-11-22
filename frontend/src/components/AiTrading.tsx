import { useEffect, useState } from "react";
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
  reason: string;
}
export function AiTrading({
  enabled,
  config,
  current,
  notify,
  onAccepted,
}: {
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
        : false,
  });
  const encoded = JSON.stringify(status.data?.settings);
  useEffect(() => {
    if (encoded) setPolicy(JSON.parse(encoded));
  }, [encoded]);
  const save = useMutation({
    mutationFn: () =>
      api("/ai/settings", { method: "PUT", body: JSON.stringify(policy) }),
    onSuccess: () => {
      setConfirm(null);
      void client.invalidateQueries({ queryKey: ["ai"] });
      notify("AI 模擬設定已儲存");
    },
    onError: (e: Error) => notify(e.message, true),
  });
  const analyze = useMutation({
    mutationFn: () =>
      api("/ai/jobs", {
        method: "POST",
        body: JSON.stringify({ symbol: current.symbol }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ai"] });
      notify("AI 分析已排入，完成後顯示建議");
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
  return (
    <div className="ai-workspace">
      <div className="section-title">
        <h1>AI 模擬交易</h1>
        <span className="badge">只產生模擬委託・不連接券商</span>
      </div>
      <div className="notice">
        <span>
          {status.data?.configured
            ? `模型 ${status.data.model} 已設定`
            : "尚未設定 OpenAI 模型金鑰（富果金鑰只提供行情）"}
          <br />
          {status.data?.schedule_configured
            ? "AWS 每日排程已設定，仍需帳戶名單與下方授權。"
            : "每日排程尚未設定；本機分析需手動觸發。"}
          <br />
          分析使用公開技術／基本／籌碼資料，會呼叫 OpenAI 並可能產生費用。AI
          建議不保證獲利，委託不自動成交。
        </span>
      </div>
      {status.error && (
        <div className="inline-error">{status.error.message}</div>
      )}
      <div className="research-grid">
        <section className="panel ai-settings">
          <div className="panel-heading">
            <h2>每日自動模擬</h2>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) =>
                setPolicy({ ...policy, enabled: e.target.checked })
              }
            />
            啟用每日 AI 自動模擬委託
          </label>
          <label className="field">
            每筆 AI 預算（元）
            <input
              type="number"
              min="100"
              max="300000"
              value={policy.budget / 100}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  budget: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
          <label className="field">
            最低信心門檻
            <input
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              value={policy.min_confidence}
              onChange={(e) =>
                setPolicy({ ...policy, min_confidence: Number(e.target.value) })
              }
            />
          </label>
          <div className="ai-symbols">
            {config.symbols.map((i) => (
              <label className="check-field" key={i.symbol}>
                <input
                  type="checkbox"
                  checked={policy.symbols.includes(i.symbol)}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      symbols: e.target.checked
                        ? [...policy.symbols, i.symbol]
                        : policy.symbols.filter((s) => s !== i.symbol),
                    })
                  }
                />
                {i.symbol} {i.name}
              </label>
            ))}
          </div>
          <Button
            disabled={!enabled || save.isPending}
            onClick={() => {
              if (policy.enabled && !status.data?.settings.enabled)
                setConfirm("enable");
              else save.mutate();
            }}
          >
            儲存設定
          </Button>
          <p className="panel-footnote">
            雲端平日 08:30 分析、09:05
            驗證即時行情後送模擬單。假日、缺資料、觀望或風控不符則跳過，不補造決策。關閉設定可立即停止後續自動委託。
          </p>
        </section>
        <section className="panel ai-settings">
          <div className="panel-heading">
            <h2>AI 推薦交易</h2>
          </div>
          <h3>
            {current.symbol} {current.name}
          </h3>
          <p className="panel-footnote">
            按下後以最新可取得的公開資料分析三個面向。分析完成後，你可以確認採用建議；執行器會重新取得報價、驗證漲跌停、資金及持倉。
          </p>
          <Button
            disabled={
              !enabled ||
              !status.data?.configured ||
              !config.symbols.some((i) => i.symbol === current.symbol) ||
              analyze.isPending
            }
            onClick={() => analyze.mutate()}
          >
            {analyze.isPending ? "排入中…" : "分析目前股票"}
          </Button>
          <p className="panel-footnote">
            僅支援既有六檔普通股。日線未還原權息，基本面尚非完整財報；即時資料缺漏時不自動委託。手動下單仍在交易工作台。
          </p>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>分析與執行紀錄</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void status.refetch()}
          >
            更新
          </Button>
        </div>
        {!status.data?.jobs.length && (
          <p className="empty">尚無 AI 分析；設定模型金鑰後可開始。</p>
        )}
        {status.data?.jobs
          .slice()
          .reverse()
          .map((job) => (
            <article className="ai-job" key={job.id}>
              <div className="row">
                <strong>
                  {job.symbol} ·{" "}
                  {{
                    queued: "排隊中",
                    running: "分析中",
                    completed: "已完成",
                    failed: "失敗",
                  }[job.status] || job.status}
                </strong>
                <small>{dateLabel(job.created_at)}</small>
              </div>
              {job.result && (
                <>
                  <h3>
                    {
                      { buy: "建議買進", sell: "建議賣出", hold: "觀望" }[
                        job.result.action
                      ]
                    }{" "}
                    · {(job.result.confidence * 100).toFixed(0)}%
                  </h3>
                  <p>{job.result.reason}</p>
                  <p className="muted">風險：{job.result.risk}</p>
                  <small>日線截至 {job.data_as_of}</small>
                </>
              )}
              {job.error && <p className="inline-error">{job.error}</p>}
              {job.execution_note && (
                <p className="muted">執行結果：{job.execution_note}</p>
              )}
              {job.order_id ? (
                <p className="down">已建立模擬委託 {job.order_id}</p>
              ) : (
                job.result?.action !== "hold" &&
                job.status === "completed" && (
                  <Button
                    size="sm"
                    disabled={execute.isPending}
                    onClick={() => setConfirm(job)}
                  >
                    採用建議・確認模擬委託
                  </Button>
                )
              )}
            </article>
          ))}
      </section>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !save.isPending && !execute.isPending) setConfirm(null);
        }}
        title={
          confirm === "enable" ? "啟用每日 AI 自動模擬？" : "確認採用 AI 建議"
        }
      >
        <p className="panel-footnote">
          {confirm === "enable"
            ? `每日排程會呼叫模型，可能產生 API 費用。每筆預算 ${money(policy.budget)}，只以虛擬資金建立委託，不會送真單。`
            : "執行器將以當下可信報價與設定預算重新計算股數，通過開市、漲跌停、資金與持倉檢查才建立模擬委託；同一分析不重複下單。"}
        </p>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            返回
          </Button>
          <Button
            disabled={save.isPending || execute.isPending}
            onClick={() => {
              if (confirm === "enable") save.mutate();
              else if (confirm) execute.mutate(confirm.id);
            }}
          >
            確認
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
