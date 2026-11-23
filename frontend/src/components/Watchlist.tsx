import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Lightbulb, TriangleAlert } from "lucide-react";
import { api, ApiError, dateLabel, money } from "../lib";
import type { Instrument } from "../types";
import { StockSearch } from "./StockSearch";
import { Button } from "./ui/button";

type Health = { key: string; status: string; created_at: string; error?: string;
  facts?: { holdings: { symbol: string; weight_pct: number }[]; held_count: number }; result?: {
  summary: string; assessment: string; risks: string[]; suggestions: string[]; limitations: string[];
} };
type Metric = { label: string; value: string; ratio: number; tone: "good" | "warn" | "neutral"; note: string };
const firstSentence = (text: string) => { const match = text.match(/^[^。！？!?]+[。！？!?]?/); return (match ? match[0] : text).slice(0, 80); };
function healthMetrics(items: Instrument[], positions: Record<string, number>, facts?: Health["facts"]): Metric[] {
  const total = items.length;
  const priced = items.filter(i => i.price != null).length;
  const latest = items.reduce((max, i) => (i.as_of && i.as_of > max ? i.as_of : max), "");
  const fresh = items.filter(i => i.price != null && !i.stale_cache && i.as_of === latest).length;
  const prices = new Map(items.map(i => [i.symbol, i.price ?? null]));
  const held = Object.entries(positions).filter(([, q]) => q > 0);
  const values = held.map(([symbol, q]) => ({ symbol, value: (prices.get(symbol) ?? 0) * q })).filter(v => v.value > 0);
  const sum = values.reduce((a, v) => a + v.value, 0);
  // Prefer the server's figure: it prices every holding, including ones not on the watchlist.
  const server = facts?.holdings?.[0];
  const top = server ? { symbol: server.symbol, value: 1 } : values.sort((a, b) => b.value - a.value)[0];
  const share = server ? server.weight_pct / 100 : top && sum ? top.value / sum : 0;
  const counted = server ? facts!.holdings.length : values.length;
  const tone = (ok: boolean): Metric["tone"] => (ok ? "good" : "warn");
  return [
    { label: "報價完整", value: total ? `${priced}/${total}` : "—", ratio: total ? priced / total : 0, tone: total ? tone(priced === total) : "neutral",
      note: !total ? "清單還是空的" : priced === total ? "每檔都有參考價" : `${total - priced} 檔缺少報價` },
    { label: "資料新鮮", value: total ? `${fresh}/${total}` : "—", ratio: total ? fresh / total : 0, tone: total ? tone(fresh === total) : "neutral",
      note: !total ? "清單還是空的" : fresh === total ? `都是 ${latest.replaceAll("-", "/")} 的資料` : `${total - fresh} 檔資料較舊` },
    held.length === 0 ? { label: "持倉集中", value: "—", ratio: 0, tone: "neutral", note: "目前沒有模擬持倉" }
      : !top ? { label: "持倉集中", value: "—", ratio: 0, tone: "neutral", note: "持倉缺少報價，無法計算" }
      : { label: "持倉集中", value: `${Math.round(share * 100)}%`, ratio: share, tone: share > 0.6 ? "warn" : "good",
          note: (held.length === 1 ? `只持有 ${top.symbol} 一檔` : `最大持倉 ${top.symbol}`) + (counted < held.length ? `，${held.length - counted} 檔缺報價未計入` : "") },
  ];
}
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
  const busy = ["queued", "running"].includes(health.data?.status || "");
  const metrics = healthMetrics(items, positions, health.data?.status === "completed" && health.data.key ? health.data.facts : undefined);
  const verdict = result ? ({ balanced: { title: "整體尚可", tone: "good" }, needs_attention: { title: "需要留意", tone: "warn" }, insufficient_data: { title: "資料不足", tone: "neutral" } }[result.assessment] || { title: "已完成", tone: "neutral" })
    : health.error || health.data?.error ? { title: "暫時無法分析", tone: "neutral" } : { title: "分析中", tone: "neutral" };
  return <div className="automation-page watchlist-page">
    <header className="automation-header"><div><h1>我的自選股</h1><p>追蹤想研究的股票，檢視清單與模擬持倉的風險。</p></div><span className="badge">{items.length} / 30 檔</span></header>
    <section className="panel watchlist-health">
      <div className="panel-heading"><h2>AI 選股健康度</h2><span className="health-updated">{health.data?.created_at ? `更新於 ${dateLabel(health.data.created_at)}` : "每天自動更新"}</span></div>
      {!hasItems ? <p className="empty">加入第一檔股票後，就會開始檢查。</p> : <div className="health-grid">
        {metrics.map(metric => <article key={metric.label} className={`health-metric ${metric.tone}`}>
          <span className="health-label">{metric.label}</span>
          <strong>{metric.value}</strong>
          <span className="health-meter" aria-hidden="true"><i className={`fill-${Math.round(metric.ratio * 10)}`} /></span>
          <p>{metric.note}</p>
        </article>)}
        <article className={`health-verdict ${verdict.tone}`}>
          <span className="health-label">AI 判斷</span>
          <strong>{verdict.title}</strong>
          {health.isPending || busy ? <p role="status"><LoaderCircle size={16} className="spin" /> 正在檢查清單與持倉…</p>
            : health.error || health.data?.error ? <><p>{health.error instanceof ApiError && health.error.status === 404 ? "健康檢查服務尚未就緒。" : health.error?.message || health.data?.error}</p>{health.error && <Button size="sm" variant="outline" disabled={health.isFetching} onClick={() => void health.refetch()}>重試</Button>}</>
            : result ? <p>{firstSentence(result.summary)}</p> : null}
        </article>
      </div>}
      {result && (result.risks.length > 0 || result.suggestions.length > 0) && <div className="health-points">
        {result.risks.slice(0, 2).map((line, index) => <p key={`r${index}`} className="health-point warn"><TriangleAlert size={16} />{firstSentence(line)}</p>)}
        {result.suggestions.slice(0, 2).map((line, index) => <p key={`s${index}`} className="health-point good"><Lightbulb size={16} />{firstSentence(line)}</p>)}
      </div>}
      {result && <details className="health-details"><summary>看完整分析</summary>
        <p>{result.summary}</p>
        {[["需要留意", result.risks], ["可以怎麼改善", result.suggestions], ["資料限制", result.limitations]].map(([title, lines]) => (lines as string[]).length ? <div key={title as string}><h3>{title as string}</h3><ul>{(lines as string[]).map((line, index) => <li key={index}>{line}</li>)}</ul></div> : null)}
        <p className="panel-footnote">健康度檢查的是資料品質與風險，不是獲利機率；AI 不會因此下單。</p>
      </details>}
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
