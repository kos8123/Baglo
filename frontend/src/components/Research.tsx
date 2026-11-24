import { dateLabel, money, pct } from "../lib";
import type { History, Research as Data } from "../types";
const net = (v: number | null | undefined) =>
  v == null ? "—" : (v > 0 ? "+" : "") + v.toLocaleString() + " 股";
function Details({
  title,
  rows,
  note,
}: {
  title: string;
  rows: [string, string][];
  note: string;
}) {
  return (
    <article className="panel research-detail">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <dl>
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="panel-footnote">{note}</p>
    </article>
  );
}
export function Research({
  data,
  history,
  error,
  loading,
}: {
  data?: Data;
  history?: History;
  error?: string;
  loading: boolean;
}) {
  const revenue = data?.fundamentals.revenue,
    valuation = data?.fundamentals.valuation,
    ownership = data?.ownership;
  const period = revenue?.period
    ? `${Number(String(revenue.period).slice(0, -2)) + 1911}/${String(revenue.period).slice(-2)}`
    : "—";
  return (
    <>
      <div className="section-title">
        <h1>個股研究</h1>
        <span className="muted">官方資料・各區塊日期分別列示</span>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">正在取得資料…</p>}
      <div className="research-grid">
        <Details
          title="技術面"
          rows={[
            ["SMA20", money(history?.sma20)],
            ["SMA60", money(history?.sma60)],
            ["本批日線筆數", String(history?.bars.length ?? "—")],
            ["最新交易日", history?.as_of || "—"],
          ]}
          note={history?.note || "歷史價格尚未取得，不推估指標"}
        />
        <Details
          title="基本面"
          rows={[
            ["營收月份", period],
            ["營收年增率", pct(revenue?.yoy_percent)],
            ["營收月增率", pct(revenue?.mom_percent)],
            ["本益比", String(valuation?.pe ?? "—")],
            ["股價淨值比", String(valuation?.pb ?? "—")],
            ["殖利率", pct(valuation?.dividend_yield_percent)],
          ]}
          note={`${data?.fundamentals.source || "等待資料"}\n營收出表日 ${revenue?.report_date || "—"}\n估值日期 ${valuation?.as_of || "—"}${revenue?.stale_cache || valuation?.stale_cache ? "\n舊快取資料" : ""}`}
        />
        <Details
          title="籌碼面"
          rows={[
            ["外陸資淨買賣", net(ownership?.foreign_net_shares)],
            ["投信淨買賣", net(ownership?.trust_net_shares)],
            ["自營商淨買賣", net(ownership?.dealer_net_shares)],
            ["三大法人合計", net(ownership?.total_net_shares)],
          ]}
          note={
            ownership?.status === "available"
              ? `${ownership.source} · ${dateLabel(ownership.as_of)}\n${ownership.note || ""}${ownership.stale_cache ? "\n舊快取資料" : ""}`
              : ownership?.reason || "等待法人資料"
          }
        />
      </div>
      <div className="notice">
        基本面目前為營收與估值，非完整財報分析。價格未還原權息；不同資料日期不代表同時發布。AI
        推薦與 AI 自動交易尚未啟用。
      </div>
    </>
  );
}
