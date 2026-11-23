import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { api, dateLabel, money } from "../lib";
import type { Instrument } from "../types";
import { StockSearch } from "./StockSearch";
import { Button } from "./ui/button";

type Health = { key: string; status: string; created_at: string; error?: string; result?: {
  summary: string; assessment: string; risks: string[]; suggestions: string[]; limitations: string[];
} };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function Watchlist({ items, current, positions, saving, onSave, onOpen }: {
  items: Instrument[]; current: Instrument; positions: Record<string, number>; saving: boolean;
  onSave: (items: Instrument[]) => void; onOpen: (item: Instrument) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [candidate, setCandidate] = useState(current);
  const [searchDirty, setSearchDirty] = useState(false);
  const [sort, setSort] = useState("saved");
  const [filter, setFilter] = useState("");
  const [day, setDay] = useState(today);
  useEffect(() => { const timer = setInterval(() => setDay(today()), 60_000); return () => clearInterval(timer); }, []);
  const signature = JSON.stringify({ symbols: items.map(i => i.symbol).sort(), positions: Object.entries(positions).filter(([,q]) => q).sort() });
  const hasItems = items.length > 0 || Object.values(positions).some(q => q > 0);
  const health = useQuery({
    queryKey: ["watchlist-health", signature, day],
    queryFn: () => api<Health>("/watchlist/health", { method: "POST", body: "{}" }),
    enabled: hasItems && !saving,
    retry: false,
    staleTime: Infinity,
    refetchInterval: q => ["queued", "running"].includes(q.state.data?.status || "") ? 4000 : false,
  });
  const rows = items.filter(i => `${i.symbol} ${i.name}`.includes(filter)).slice().sort((a,b) =>
    sort === "code" ? a.symbol.localeCompare(b.symbol) : sort === "price" ? (b.price ?? -1) - (a.price ?? -1) : 0);
  const result = health.data?.result;
  return <div className="automation-page watchlist-page">
    <header className="automation-header"><div><h1>我的自選股</h1><p>追蹤想研究的股票，檢視清單與模擬持倉的風險。</p></div><span className="badge">{items.length} / 30 檔</span></header>
    <section className="panel watchlist-health"><div className="panel-heading"><h2>AI 選股健康度</h2><span className="badge">{({ balanced: "整體尚可", needs_attention: "需要留意", insufficient_data: "資料不足" }[result?.assessment || ""] || "清單總結")}</span></div>
      <div className="watchlist-health-body">
        <p className="panel-footnote">持倉、自選名單有變動，或台北日期換日後自動更新；同一份資料當天沿用結果。AI 不會因此建立委託。</p>
        {!hasItems ? <p className="empty">加入第一檔股票後，就會開始產生健康摘要。</p> : health.isPending || ["queued", "running"].includes(health.data?.status || "") ? <p role="status"><LoaderCircle size={18} className="spin" /> 正在檢視整份清單與持倉，完成後自動顯示…</p> : health.error || health.data?.error ? <p className="inline-error">{health.error?.message || health.data?.error}</p> : result ? <>
          <p className="health-summary">{result.summary}</p>
          <div className="health-columns">{[["需要留意", result.risks], ["可以怎麼改善", result.suggestions], ["資料限制", result.limitations]].map(([title, lines]) => <div key={title as string}><h3>{title as string}</h3><ul>{(lines as string[]).map((line,index) => <li key={index}>{line}</li>)}</ul></div>)}</div>
          <p className="panel-footnote">更新時間 {dateLabel(health.data?.created_at)} · 健康度是風險與資料品質檢視，不是獲利機率。</p>
        </> : null}
      </div>
    </section>
    <section className="panel watchlist-add"><div className="panel-heading"><h2>加入追蹤</h2></div>
      <div className="watchlist-add-form"><StockSearch selected={candidate} onSelect={setCandidate} onDirty={setSearchDirty} enabled />
        <Button disabled={searchDirty || saving || items.length >= 30 || items.some(i => i.symbol === candidate.symbol)} onClick={() => onSave([...items, candidate])}>加入 {candidate.symbol} {candidate.name}</Button>
      </div><p className="panel-footnote">已加入的股票會保存在帳戶，重新整理後仍可查看。</p>
    </section>
    <section className="panel"><div className="panel-heading"><h2>追蹤清單</h2></div>
      <div className="watchlist-filters"><label className="field">搜尋清單<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="代號或名稱" /></label><label className="field">排序<select value={sort} onChange={e => setSort(e.target.value)}><option value="saved">加入順序</option><option value="code">股票代號</option><option value="price">價格由高到低</option></select></label></div>
      <div className="automation-table-scroll"><table><thead><tr><th>股票</th><th>收盤參考</th><th>資料日期</th><th>資料狀態</th><th>操作</th></tr></thead><tbody>{rows.map(item => <tr key={item.symbol}><td><Button variant="ghost" onClick={() => onOpen(item)}>{item.symbol} {item.name}</Button></td><td>{money(item.price)}</td><td>{item.as_of?.replaceAll("-", "/") || "未取得"}</td><td>{item.price == null ? "缺少報價" : item.stale_cache ? "舊快取，請留意日期" : "已有參考價"}</td><td><Button size="sm" variant="ghost" onClick={() => onOpen(item)}>前往交易</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => onSave(items.filter(i => i.symbol !== item.symbol))}>移除</Button></td></tr>)}</tbody></table></div>
      {!rows.length && <p className="empty">{items.length ? "沒有符合搜尋的股票。" : "還沒有自選股，先在上方搜尋加入。"}</p>}
    </section>
  </div>;
}
