import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, dateLabel, money, shares } from "../lib";
import type { Account, Config, Instrument } from "../types";
import { Button } from "./ui/button";
export function Orders({
  account,
  config,
  notify,
}: {
  account?: Account;
  config: Config;
  notify: (message: string, error?: boolean) => void;
}) {
  const [filter, setFilter] = useState("all"),
    client = useQueryClient();
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) =>
      api("/orders/" + encodeURIComponent(id) + "/" + type, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (_, vars) => {
      void client.invalidateQueries({ queryKey: ["account"] });
      void client.invalidateQueries({ queryKey: ["portfolio"] });
      notify(
        vars.type === "cancel"
          ? "委託已取消"
          : "已完成本機沙盒成交，非真實市場成交",
      );
    },
    onError: (e: Error) => notify(e.message, true),
  });
  const items = (account?.orders || [])
    .filter((o) => filter === "all" || o.status === filter)
    .slice()
    .reverse();
  return (
    <>
      <div className="table-toolbar">
        <div className="segmented">
          {[
            ["all", "全部"],
            ["pending", "待成交"],
            ["filled", "已成交"],
            ["cancelled", "已取消"],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void client.invalidateQueries({ queryKey: ["account"] });
            void client.invalidateQueries({ queryKey: ["portfolio"] });
          }}
        >
          <RefreshCw size={13} /> 更新
        </Button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>股票</th>
              <th>方向</th>
              <th>交易類別</th>
              <th>股數</th>
              <th>限價</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr key={order.id}>
                <td className="muted">{dateLabel(order.created_at)}</td>
                <td>
                  <strong>{order.symbol}</strong> {order.name || ""}
                </td>
                <td className={order.side === "buy" ? "up" : "down"}>
                  {order.side === "buy" ? "買進" : "賣出"}
                </td>
                <td>
                  {order.market_type === "board_lot"
                    ? "整股"
                    : order.market_type === "odd_lot"
                      ? "零股"
                      : "舊制"}
                </td>
                <td title={shares(order.quantity)}>
                  {order.quantity.toLocaleString()}
                </td>
                <td>{money(order.limit_price)}</td>
                <td>
                  <span className={"order-status " + order.status}>
                    {
                      {
                        pending: "待成交",
                        filled: "已成交",
                        cancelled: "已取消",
                      }[order.status]
                    }
                  </span>
                </td>
                <td>
                  {order.status === "pending" && (
                    <div className="row">
                      {[
                        ["cancel", "取消"],
                        ...(config.demo ? [["demo-fill", "沙盒成交"]] : []),
                      ].map(([type, label]) => (
                        <Button
                          key={type}
                          variant="outline"
                          size="sm"
                          disabled={action.isPending}
                          onClick={() => action.mutate({ id: order.id, type })}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && (
          <div className="empty">
            {account ? "此分類目前沒有委託" : "請先登入並載入帳戶"}
          </div>
        )}
      </div>
      <p className="panel-footnote">
        純模擬。委託不自動撮合；本機「沙盒成交」以限價示範，未模擬委託簿、滑價與交割。手續費
        0.1425%（最低 20 元），股票賣出稅 0.3%。帳本最多 150 筆。
      </p>
    </>
  );
}
export function Positions({
  account,
  instruments,
  onSelect,
}: {
  account?: Account;
  instruments: Instrument[];
  onSelect: (item: Instrument) => void;
}) {
  const items = Object.entries(account?.positions || {}).filter(
    ([, qty]) => qty > 0,
  );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>股票</th>
            <th>持有股數</th>
            <th>張／股</th>
            <th>估值</th>
          </tr>
        </thead>
        <tbody>
          {items.map(([symbol, qty]) => {
            const item = instruments.find((i) => i.symbol === symbol) || {
              symbol,
              name:
                account?.orders.find((o) => o.symbol === symbol)?.name ||
                symbol,
            };
            return (
              <tr key={symbol}>
                <td>
                  <button
                    className="link-button"
                    onClick={() => onSelect(item)}
                  >
                    <strong>{symbol}</strong> {item.name}
                  </button>
                </td>
                <td>{qty.toLocaleString()}</td>
                <td>{shares(qty)}</td>
                <td className="muted">未計算即時市值</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length && (
        <div className="empty">
          {account ? "目前沒有持倉" : "請先登入查看持倉"}
        </div>
      )}
    </div>
  );
}
