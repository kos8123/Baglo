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
  return (
    <div className="automation-controls">
      <div className="notice automation-status">
        <span>
          {status.isPending
            ? "正在讀取模型與排程狀態…"
            : status.error
              ? "模型狀態讀取失敗，請重試"
              : status.data?.configured
                ? `模型 ${status.data.model} 已設定`
                : "尚未設定 Gemini 模型金鑰（富果金鑰只提供行情）"}
          <br />
          {status.isPending || status.error
            ? ""
            : status.data?.schedule_configured
              ? "每日排程已就緒；儲存啟用設定後才會自動執行。"
              : "每日排程尚未啟動，目前僅可手動分析。"}
          <br />
          分析使用公開技術／基本／籌碼資料，會呼叫 Gemini；費用與配額依 Google
          專案設定，不自動切換模型。AI 建議不保證獲利，委託不自動成交。
        </span>
      </div>
      <section className="panel ai-connection">
        <div className="panel-heading">
          <h2>模型連線</h2>
          <span className="badge">Gemini API</span>
        </div>
        <p className="panel-footnote">
          模型供應商為 Gemini。連線測試會使用少量 API 額度，不建立委託。
        </p>
        <div className="backtest-actions">
          <Button
            disabled={!enabled || connection.isPending}
            onClick={() => connection.mutate()}
          >
            {connection.isPending ? "測試模型中…" : "測試模型連線"}
          </Button>
          <Button variant="outline" onClick={() => void status.refetch()}>
            重新讀取狀態
          </Button>
        </div>
        {connection.error && (
          <p className="inline-error">{connection.error.message}</p>
        )}
        {connection.data && (
          <p className="panel-footnote">
            {connection.data.model} · {dateLabel(connection.data.tested_at)} ·{" "}
            {connection.data.message}
          </p>
        )}
      </section>
      {status.error && (
        <div className="inline-error">{status.error.message}</div>
      )}
      <>
        {
          <section className="panel ai-settings">
            <div className="panel-heading">
              <h2>全市場 AI 模擬設定</h2>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={policy.enabled}
                onChange={(e) => (
                  setChanged(true),
                  setPolicy({ ...policy, enabled: e.target.checked })
                )}
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
                onChange={(e) => (
                  setChanged(true),
                  setPolicy({
                    ...policy,
                    budget: Math.round(Number(e.target.value) * 100),
                  })
                )}
              />
            </label>
            <label className="field">
              最低信心門檻（%，AI 至少多有把握才考慮下單）
              <input
                type="number"
                min="50"
                max="100"
                step="5"
                aria-describedby="confidence-help"
                value={Math.round(policy.min_confidence * 100)}
                onChange={(e) => (
                  setChanged(true),
                  setPolicy({
                    ...policy,
                    min_confidence: Number(e.target.value) / 100,
                  })
                )}
              />
            </label>
            <p id="confidence-help" className="confidence-help">
              目前設為{" "}
              <strong>{Math.round(policy.min_confidence * 100)}%</strong>
              ：AI 自評把握低於這個分數，就跳過這次委託。例如門檻 70%，自評 80%
              可進一步檢查，自評 60% 就不下單。
              <br />
              <strong>這不是獲利機率。</strong>
              設得高通常會少交易，但不保證比較準或比較賺；達門檻後仍要通過資金、持倉與行情檢查。AI
              分數是否可靠需累積建議與結果驗證；可在下方回測比較驗證績效。
            </p>
            <p className="notice">
              不需自行加入股票。系統會依前一交易日成交金額、資料新鮮度與極端漲跌條件，
              從上市櫃普通股先取 40 檔，再自動略過歷史資料不足者；前 12 檔完整資料才交給 AI，
              最多選出 3 檔。既有持倉優先納入檢查。
            </p>

            <Button
              disabled={!enabled || save.isPending}
              onClick={() => {
                if (policy.enabled && !status.data?.settings.enabled)
                  setConfirm("enable");
                else save.mutate();
              }}
            >
              {changed ? "儲存設定（有未儲存變更）" : "儲存設定"}
            </Button>
            <p className="panel-footnote">
              平日 08:30 起分析、09:05 起驗證即時行情後送模擬單。每日先做全市場初篩與回測，至多選出三檔，再分析當日訊號；未達條件就保留現金。13:00
              後不啟動新選股研究。電腦休眠或服務停止時不會執行。假日、缺資料、觀望或風控不符則跳過，不補造決策。關閉設定可立即停止後續自動委託。
            </p>
          </section>
        }
      </>
      <section className="panel automation-log">
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
