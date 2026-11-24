import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, money, pct, dateLabel } from "../lib";
import type { Instrument } from "../types";
import { Button } from "./ui/button";
interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  cost: number | null;
  average_price: number | null;
  price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  return_percent: number | null;
  as_of: string;
  source: string;
  price_kind: string;
}
interface Snapshot {
  items: Holding[];
  cash: number;
  total_market_value: number | null;
  total_equity: number | null;
  realized_pnl: number;
  note: string;
}
export function Portfolio({
  enabled,
  onSelect,
}: {
  enabled: boolean;
  onSelect: (item: Instrument) => void;
}) {
  const data = useQuery({
    queryKey: ["portfolio"],
    queryFn: ({ signal }) => api<Snapshot>("/portfolio", { signal }),
    enabled,
    staleTime: 15000,
  });
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>我的持倉</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void data.refetch()}
          disabled={!enabled || data.isFetching}
        >
          <RefreshCw size={14} />
          更新估值
        </Button>
      </div>
      <div className="portfolio-summary">
        {[
          ["庫存市值", money(data.data?.total_market_value)],
          ["帳戶權益", money(data.data?.total_equity)],
          ["累計已實現損益", money(data.data?.realized_pnl)],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      {data.error && <div className="inline-error">{data.error.message}</div>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "股票",
                "持有股數",
                "可賣／委託保留",
                "平均成本",
                "參考價格",
                "庫存市值",
                "未實現損益",
                "報酬率",
                "價格時間",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data?.items.map((i) => (
              <tr key={i.symbol}>
                <td>
                  <button
                    className="link-button"
                    onClick={() => onSelect({ symbol: i.symbol, name: i.name })}
                  >
                    {i.symbol} {i.name}
                  </button>
                </td>
                <td>{i.quantity.toLocaleString()}</td>
                <td>
                  {i.available_quantity.toLocaleString()} ／{" "}
                  {i.reserved_quantity.toLocaleString()}
                </td>
                <td>{money(i.average_price)}</td>
                <td>{money(i.price)}</td>
                <td>{money(i.market_value)}</td>
                <td className={(i.unrealized_pnl || 0) >= 0 ? "up" : "down"}>
                  {money(i.unrealized_pnl)}
                </td>
                <td>{pct(i.return_percent)}</td>
                <td>
                  {dateLabel(i.as_of)}
                  <br />
                  <small>
                    {i.source} ·{" "}
                    {i.price_kind === "live"
                      ? "現價"
                      : i.price_kind === "last_trade"
                        ? "最近成交"
                        : "收盤／缺漏參考"}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.data?.items.length && (
          <div className="empty">
            {data.isFetching
              ? "正在載入持倉…"
              : "尚無已成交持倉；送出委託不代表成交，請先查看委託狀態。"}
          </div>
        )}
      </div>
      <p className="panel-footnote">{data.data?.note}</p>
    </section>
  );
}
