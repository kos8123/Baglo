import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, LoaderCircle } from "lucide-react";
import { api, dateLabel, money } from "../lib";
import type { Instrument } from "../types";
import { StockSearch } from "./StockSearch";
import { Button } from "./ui/button";

type Analysis = { id: string; symbol: string; status: string; created_at: string; error?: string; result?: { action: string; reason: string; risk: string; confidence: number } };

export function Watchlist({ items, current, saving, onSave, onOpen, notify }: {
  items: Instrument[]; current: Instrument; saving: boolean;
  onSave: (items: Instrument[]) => void; onOpen: (item: Instrument) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const client = useQueryClient();
  const [candidate, setCandidate] = useState(current);
  const [searchDirty, setSearchDirty] = useState(false);
  const [sort, setSort] = useState("saved");
  const [filter, setFilter] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const analysis = useQuery({
    queryKey: ["ai"], queryFn: ({ signal }) => api<{ jobs: Analysis[] }>("/ai", { signal }),
    refetchInterval: q => q.state.data?.jobs.some(j => ["queued", "running"].includes(j.status)) ? 3000 : false,
  });
  const review = useMutation({
    mutationFn: (symbol: string) => api<Analysis>("/ai/jobs", { method: "POST", body: JSON.stringify({ symbol }) }),
    onSuccess: (job) => { setReviewing(true); setSubmitted(ids => [...ids, job.id]); void client.invalidateQueries({ queryKey: ["ai"] }); notify("已送出自選股檢視，結果會自動更新。"); },
    onError: (error: Error) => notify(error.message, true),
  });
  const rows = items.filter(i => `${i.symbol} ${i.name}`.includes(filter)).slice().sort((a,b) =>
    sort === "code" ? a.symbol.localeCompare(b.symbol) : sort === "price" ? (b.price ?? -1) - (a.price ?? -1) : 0);
  const jobs = (analysis.data?.jobs || []).filter(j => items.some(i => i.symbol === j.symbol));
  return <div className="automation-page">
    <header className="automation-header"><div><h1><Star size={24} /> 我的自選股</h1><p>保存想追蹤的股票，查看資料品質，再讓 AI 幫你檢視選股理由與風險。</p></div><span className="badge">{items.length} / 30 檔</span></header>
    <section className="panel"><div className="panel-heading"><h2>加入追蹤</h2></div>
      <div className="backtest-actions"><StockSearch selected={candidate} onSelect={setCandidate} onDirty={setSearchDirty} enabled />
      <Button disabled={searchDirty || saving || items.length >= 30 || items.some(i => i.symbol === candidate.symbol)} onClick={() => onSave([...items, candidate])}>加入 {candidate.symbol} {candidate.name}</Button></div>
      <p className="panel-footnote">自選股會保存在你的帳戶，重新整理後仍可查看。收盤參考價依資料日期顯示。</p>
    </section>
    <section className="panel"><div className="panel-heading"><h2>追蹤清單</h2><Button variant="outline" onClick={() => setReviewing(v => !v)}>{reviewing ? "收起 AI 檢視" : "AI 檢視自選股"}</Button></div>
      <div className="backtest-actions"><label className="field">搜尋清單<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="代號或名稱" /></label><label className="field">排序<select value={sort} onChange={e => setSort(e.target.value)}><option value="saved">加入順序</option><option value="code">股票代號</option><option value="price">價格由高到低</option></select></label></div>
      <div className="automation-table-scroll"><table><thead><tr><th>股票</th><th>收盤參考</th><th>資料日期</th><th>資料狀態</th><th>操作</th></tr></thead><tbody>{rows.map(item => <tr key={item.symbol}><td>{item.symbol} {item.name}</td><td>{money(item.price)}</td><td>{item.as_of || "未取得"}</td><td>{item.price == null ? "缺少報價" : item.stale_cache ? "舊快取，請留意日期" : "已有參考價"}</td><td><Button size="sm" variant="ghost" onClick={() => onOpen(item)}>看 K 線</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => onSave(items.filter(i => i.symbol !== item.symbol))}>移除</Button></td></tr>)}</tbody></table></div>
      {!rows.length && <p className="empty">{items.length ? "沒有符合搜尋的股票。" : "還沒有自選股，先在上方搜尋並加入第一檔。"}</p>}
    </section>
    {reviewing && <section className="panel"><div className="panel-heading"><h2>AI 選股健檢</h2></div>
      <p className="panel-footnote">逐檔選擇「檢視風險」，AI 會依技術、基本與籌碼資料說明理由與盲點。每次會使用模型額度；這裡只分析，不會下單。尚未提供整體產業集中度或相關性分析。</p>
      <div className="backtest-actions">{items.map(i => <Button key={i.symbol} variant="outline" disabled={review.isPending || jobs.some(j => j.symbol === i.symbol && ["queued", "running"].includes(j.status))} onClick={() => review.mutate(i.symbol)}>檢視 {i.symbol} {i.name} 的風險</Button>)}</div>
      {analysis.error && <p className="inline-error">{analysis.error.message}</p>}
      {submitted.length > 0 && !jobs.length && <p role="status">正在讀取分析狀態…</p>}
      {jobs.map(job => <article className="watchlist-review" key={job.id}><h3>{job.symbol} {items.find(i => i.symbol === job.symbol)?.name} · {dateLabel(job.created_at)}</h3>{["queued", "running"].includes(job.status) ? <p role="status"><LoaderCircle className="spin" size={16} /> AI 正在整理資料與檢視風險…</p> : job.error ? <p className="inline-error">{job.error}</p> : job.result ? <><p><strong>觀察結果：</strong>{({ buy: "偏向買進", sell: "偏向減碼", hold: "觀望" }[job.result.action] || job.result.action)} · AI 自評信心 {Math.round(job.result.confidence * 100)}%（不是獲利機率）</p><p><strong>選股理由：</strong>{job.result.reason}</p><p><strong>需要留意：</strong>{job.result.risk}</p></> : <p>尚未取得有效分析結果。</p>}</article>)}
      {!jobs.length && !submitted.length && <p className="empty">選一檔自選股開始檢視；完成後會顯示分析理由和需要留意的風險。</p>}
    </section>}
  </div>;
}
