import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { api, submitPaperOrder, dateLabel, money, tick } from "../lib";
import type {
  Account,
  Config,
  Instrument,
  Market,
  OrderBody,
  Side,
  Venue,
} from "../types";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
export const quoteLabel = (data?: Market) =>
  data?.quote.kind === "live"
    ? data.quote.market_type === "odd_lot"
      ? "零股現價"
      : "整股現價"
    : data?.quote.kind === "last_trade"
      ? "最近成交參考價"
      : "最近收盤參考價";
interface Review {
  body: OrderBody;
  payload: string;
  key: string;
  name: string;
  fee: number;
  tax: number;
  total: number;
  origin: string;
}
export function OrderTicket({
  selected,
  config,
  account,
  enabled,
  searchDirty,
  notify,
  onAccepted,
}: {
  selected: Instrument;
  config: Config;
  account?: Account;
  enabled: boolean;
  searchDirty: boolean;
  notify: (message: string, error?: boolean) => void;
  onAccepted: () => void;
}) {
  const [venue, setVenue] = useState<Venue>("odd_lot"),
    [drafts, setDrafts] = useState({ odd_lot: "10", board_lot: "1" }),
    [price, setPrice] = useState(""),
    [side, setSide] = useState<Side>("buy"),
    [custom, setCustom] = useState(false),
    [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState("");
  const manual = useRef(false),
    pending = useRef<{ payload: string; key: string } | null>(null),
    sending = useRef(false),
    client = useQueryClient();
  const market = useQuery({
    queryKey: ["market", selected.symbol, venue],
    queryFn: ({ signal }) =>
      api<Market>("/market/" + selected.symbol + "?market_type=" + venue, {
        signal,
      }),
    enabled,
    staleTime: 30000,
  });
  useEffect(() => {
    manual.current = false;
    setCustom(false);
    setPrice("");
    setError("");
    setReview(null);
  }, [selected.symbol]);
  useEffect(() => {
    if (market.data?.quote.price && !manual.current) {
      setPrice((market.data.quote.price / 100).toFixed(2));
      setCustom(false);
    }
  }, [market.data]);
  const quantity = Number(drafts[venue]) * (venue === "board_lot" ? 1000 : 1),
    cents = Math.round(Number(price) * 100),
    gross = quantity * cents,
    fee = Math.max(2000, Math.round(gross * 0.001425)),
    tax = Math.round(gross * 0.003),
    total = side === "sell" ? gross - fee - tax : gross + fee;
  const available = account
    ? account.cash -
      account.orders
        .filter((o) => o.status === "pending" && o.side === "buy")
        .reduce((sum, o) => sum + o.reserved, 0)
    : 0;
  const sellable = account
    ? (account.positions[selected.symbol] || 0) -
      account.orders
        .filter(
          (o) =>
            o.status === "pending" &&
            o.side === "sell" &&
            o.symbol === selected.symbol,
        )
        .reduce((sum, o) => sum + o.quantity, 0)
    : 0;
  const limits = market.data?.instrument.price_limits,
    validQuantity =
      Number.isInteger(Number(drafts[venue])) &&
      Number(drafts[venue]) >= 1 &&
      Number(drafts[venue]) <= (venue === "board_lot" ? 499 : 999);
  const validPrice =
    Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000;
  let hint = "";
  if (
    validPrice &&
    limits?.status === "available" &&
    (cents < limits.lower! || cents > limits.upper!)
  )
    hint = "限價超出漲跌停範圍";
  else if (validQuantity && validPrice && account)
    hint =
      side === "buy" && gross + fee > available
        ? "可用模擬資金不足"
        : side === "sell" && quantity > sellable
          ? "可賣股數不足"
          : "";
  const changePrice = (value: string) => {
    manual.current = true;
    setCustom(true);
    setPrice(value);
    setError("");
  };
  const step = (direction: number) => {
    const current = cents > 0 ? cents : market.data?.quote.price || 1,
      unit = tick(direction < 0 ? Math.max(1, current - 1) : current, config);
    changePrice(
      (
        Math.max(
          1,
          Math.min(
            10000000,
            (direction > 0
              ? Math.floor(current / unit) + 1
              : Math.ceil(current / unit) - 1) * unit,
          ),
        ) / 100
      ).toFixed(2),
    );
  };
  const submit = useMutation({
    mutationFn: (item: Review) => submitPaperOrder(item),
    onSuccess: (accepted) => {
      setError("");
      client.setQueryData<Account>(["account"], (old) =>
        old && !old.orders.some((o) => o.id === accepted.id)
          ? { ...old, orders: [...old.orders, accepted] }
          : old,
      );
      pending.current = null;
      setReview(null);
      onAccepted();
      notify("委託已送出，請至委託紀錄查詢；尚未成交。");
      void client.invalidateQueries({ queryKey: ["account"] });
      void client.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      notify(e.message, true);
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const prepare = (direction: Side) => {
    setSide(direction);
    setError("");
    let issue = "";
    if (!account || !enabled) issue = "請先登入並載入帳戶";
    else if (searchDirty) issue = "請先從搜尋結果選擇下單標的";
    else if (!validQuantity)
      issue =
        venue === "board_lot" ? "整股請輸入 1～499 張" : "零股請輸入 1～999 股";
    else if (!validPrice) issue = "請輸入有效限價";
    else if (cents % tick(cents, config))
      issue = `此價位每檔為 ${money(tick(cents, config))}，請用 ＋／− 調整`;
    else if (limits?.status !== "available")
      issue = "漲跌停資料尚未確認，請重新取得報價";
    else if (cents < limits.lower! || cents > limits.upper!)
      issue =
        "限價須介於跌停 " +
        money(limits.lower) +
        " 與漲停 " +
        money(limits.upper);
    else if (direction === "buy" && gross + fee > available)
      issue = "可用模擬資金不足";
    else if (direction === "sell" && quantity > sellable)
      issue = "可賣股數不足，本版不支援放空";
    if (issue) {
      setError(issue);
      notify(issue, true);
      return;
    }
    const body: OrderBody = {
        symbol: selected.symbol,
        side: direction,
        quantity,
        market_type: venue,
        limit_price: cents,
      },
      payload = JSON.stringify(body);
    if (pending.current?.payload !== payload)
      pending.current = { payload, key: crypto.randomUUID() };
    setReview({
      body,
      payload,
      key: pending.current!.key,
      name: selected.name,
      fee,
      tax: direction === "sell" ? tax : 0,
      total: direction === "sell" ? gross - fee - tax : gross + fee,
      origin: custom
        ? "自訂限價"
        : quoteLabel(market.data) + " · " + market.data?.quote.source,
    });
  };
  return (
    <section className="panel order-ticket">
      <div className="panel-heading">
        <h2>現股委託</h2>
        <span className="badge">模擬帳戶</span>
      </div>
      <div className="ticket-instrument">
        <strong>
          {selected.symbol} {selected.name}
        </strong>
        <span>{selected.exchange === "TPEx" ? "上櫃" : "上市"}</span>
      </div>
      <div
        className="segmented venue-switch"
        role="group"
        aria-label="交易類別"
      >
        {(["board_lot", "odd_lot"] as Venue[]).map((v) => (
          <Button
            key={v}
            variant="ghost"
            aria-pressed={venue === v}
            className={venue === v ? "selected" : ""}
            onClick={() => {
              setVenue(v);
              setError("");
            }}
          >
            {v === "board_lot" ? "整股・張" : "零股・股"}
          </Button>
        ))}
      </div>
      <div className="reference-price">
        <div className="row">
          <span>{quoteLabel(market.data)}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!enabled || market.isFetching}
            aria-label="更新報價"
            onClick={() => {
              void market.refetch().then((result) => {
                if (result.error) notify(result.error.message, true);
                else
                  notify(
                    manual.current
                      ? "報價已更新，保留你的自訂限價"
                      : "參考價格已更新",
                  );
              });
            }}
          >
            <RefreshCw size={12} className={market.isFetching ? "spin" : ""} />{" "}
            更新
          </Button>
        </div>
        <strong>
          {market.isPending ? "—" : money(market.data?.quote.price)}
        </strong>
        <p>
          {market.error ? (
            market.error.message
          ) : market.data ? (
            <>
              {market.data.quote.source} · {dateLabel(market.data.quote.as_of)}
              {market.data.quote.stale_cache ? " · 舊快取" : ""}
              <br />
              {market.data.quote.reason}
              <br />
              資料取得 {dateLabel(market.data.quote.fetched_at)}
            </>
          ) : (
            "等待行情資料"
          )}
        </p>
      </div>
      <form onSubmit={(e) => e.preventDefault()}>
        <label className="field">
          {venue === "board_lot" ? "委託張數" : "委託股數"}
          <input
            type="number"
            min="1"
            max={venue === "board_lot" ? 499 : 999}
            step="1"
            value={drafts[venue]}
            onChange={(e) => setDrafts({ ...drafts, [venue]: e.target.value })}
          />
        </label>
        <div className="field-hint">
          {validQuantity
            ? `${quantity.toLocaleString()} 股${venue === "board_lot" ? "（1 張 = 1,000 股）" : ""}`
            : "請輸入有效整數"}
        </div>
        <label className="field" htmlFor="limit-price">
          限價（新臺幣／股）
        </label>
        <div className="price-stepper">
          <Button
            variant="outline"
            size="icon"
            aria-label="限價減少一檔"
            onClick={() => step(-1)}
          >
            <Minus size={15} />
          </Button>
          <input
            id="limit-price"
            type="number"
            min="0.01"
            max="100000"
            step="0.01"
            value={price}
            placeholder="請輸入限價"
            onChange={(e) => changePrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                step(e.key === "ArrowUp" ? 1 : -1);
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="限價增加一檔"
            onClick={() => step(1)}
          >
            <Plus size={15} />
          </Button>
        </div>
        <div className="price-origin">
          <span>{custom ? "自訂限價・更新報價不覆蓋" : "自動帶入參考價"}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!market.data?.quote.price}
            onClick={() => {
              manual.current = false;
              setCustom(false);
              setPrice((market.data!.quote.price! / 100).toFixed(2));
            }}
          >
            帶入報價
          </Button>
        </div>
        <div className="limit-band">
          {limits?.status === "available" ? (
            <>
              <span>
                跌停 <b className="down">{money(limits.lower)}</b>
              </span>
              <span>
                漲停 <b className="up">{money(limits.upper)}</b>
              </span>
              <small>
                {limits.as_of}
                {limits.historical_session ? "・最近交易日模擬" : ""}
              </small>
            </>
          ) : (
            <small>{limits?.reason || "漲跌停資料尚未確認"}</small>
          )}
        </div>
        <dl className="estimate">
          <div>
            <dt>委託金額</dt>
            <dd>{validQuantity && validPrice ? money(gross) : "—"}</dd>
          </div>
          <div>
            <dt>預估手續費</dt>
            <dd>{validQuantity && validPrice ? money(fee) : "—"}</dd>
          </div>
          {side === "sell" && (
            <div>
              <dt>預估證交稅</dt>
              <dd>{validQuantity && validPrice ? money(tax) : "—"}</dd>
            </div>
          )}
          <div className="estimate-total">
            <dt>{side === "buy" ? "預估保留金額" : "預估賣出淨額"}</dt>
            <dd>{validQuantity && validPrice ? money(total) : "—"}</dd>
          </div>
        </dl>
        <div className="ticket-balances">
          <span>可用 {money(available)}</span>
          <span>可賣 {sellable.toLocaleString()} 股</span>
        </div>
        {(error || hint) && (
          <p className="inline-error" role="alert">
            {error || hint}
          </p>
        )}
        <div className="trade-buttons">
          <Button
            variant="buy"
            disabled={!account || !enabled || submit.isPending}
            onClick={() => prepare("buy")}
          >
            買進
          </Button>
          <Button
            variant="sell"
            disabled={!account || !enabled || submit.isPending}
            onClick={() => prepare("sell")}
          >
            賣出
          </Button>
        </div>
      </form>
      <p className="ticket-disclaimer">
        <ShieldCheck size={14} /> 虛擬資金・不連接券商・委託不保證成交
      </p>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !submit.isPending) setReview(null);
        }}
        title={review?.body.side === "sell" ? "確認賣出委託" : "確認買進委託"}
      >
        {review && (
          <>
            <dl className="review-details">
              {[
                ["標的", review.body.symbol + " " + review.name],
                ["方向", review.body.side === "buy" ? "買進" : "賣出"],
                [
                  "類別",
                  review.body.market_type === "board_lot" ? "整股" : "零股",
                ],
                [
                  "數量",
                  review.body.market_type === "board_lot"
                    ? `${review.body.quantity / 1000} 張（${review.body.quantity.toLocaleString()} 股）`
                    : `${review.body.quantity} 股`,
                ],
                ["每股限價", money(review.body.limit_price)],
                ["手續費", money(review.fee)],
                ["證交稅", money(review.tax)],
                ["預估金額", money(review.total)],
                ["價格來源", review.origin],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {submit.error && (
              <p className="inline-error">{submit.error.message}</p>
            )}
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={submit.isPending}
                onClick={() => setReview(null)}
              >
                返回修改
              </Button>
              <Button
                variant={review.body.side}
                disabled={submit.isPending}
                onClick={() => {
                  if (sending.current) return;
                  sending.current = true;
                  submit.mutate(review);
                }}
              >
                {submit.isPending
                  ? "送出中…"
                  : review.body.side === "buy"
                    ? "確認買進"
                    : "確認賣出"}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
