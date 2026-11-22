import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { matchesInstrument } from "../selection";
import { api, money } from "../lib";
import type { Instrument, SearchResult } from "../types";
import { Button } from "./ui/button";
export function StockSearch({
  selected,
  onSelect,
  onDirty,
  enabled,
}: {
  selected: Instrument;
  onSelect: (item: Instrument) => void;
  onDirty: (value: boolean) => void;
  enabled: boolean;
}) {
  const [text, setText] = useState(selected.symbol + " " + selected.name),
    [low, setLow] = useState(""),
    [high, setHigh] = useState(""),
    [open, setOpen] = useState(false),
    [debounced, setDebounced] = useState(""),
    [active, setActive] = useState(-1),
    [composing, setComposing] = useState(false);
  const box = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const label = selected.symbol + " " + selected.name;
  const matchesSelected = (value: string) => matchesInstrument(value, selected);
  useEffect(() => {
    setText(label);
    setOpen(false);
    setActive(-1);
    onDirty(false);
  }, [label]);
  const params = new URLSearchParams({ q: text });
  if (low !== "") params.set("min_price", low);
  if (high !== "") params.set("max_price", high);
  const search = params.toString();
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => {
      setDebounced(search);
      setActive(-1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, composing]);
  const result = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) =>
      api<SearchResult>("/instruments?" + debounced, { signal }),
    enabled: enabled && open && !composing && debounced === search,
  });
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (active >= 0)
      box.current
        ?.querySelector(`[data-result="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const items = debounced === search ? result.data?.items || [] : [];
  const choose = (item: Instrument) => {
    onSelect(item);
    setOpen(false);
    setText(item.symbol + " " + item.name);
    onDirty(false);
  };
  useEffect(() => {
    if (
      open &&
      !composing &&
      debounced === search &&
      items.length === 1 &&
      matchesInstrument(text, items[0])
    )
      choose(items[0]);
  }, [result.data, debounced, search, open, composing]);
  const filter = (which: "low" | "high", value: string) => {
    which === "low" ? setLow(value) : setHigh(value);
    if (text === label) setText("");
    onDirty(true);
    setOpen(true);
  };
  return (
    <div className="instrument-search" ref={box}>
      <label htmlFor="stock-search">搜尋股票</label>
      <div className="search-input">
        <Search size={17} />
        <input
          id="stock-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="stock-results"
          aria-expanded={open && !!items.length}
          aria-activedescendant={
            active >= 0 ? "stock-option-" + active : undefined
          }
          value={text}
          placeholder="代號或股票名稱"
          onFocus={(e) => {
            e.currentTarget.select();
            setOpen(true);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onChange={(e) => {
            setText(e.target.value);
            onDirty(!matchesSelected(e.target.value));
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (composing) return;
            if (e.key === "Escape") {
              setText(label);
              onDirty(false);
              setOpen(false);
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (open && items.length) choose(items[Math.max(0, active)]);
            }
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setOpen(true);
              if (items.length)
                setActive(
                  (i) =>
                    (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                    items.length,
                );
            }
          }}
          ref={input}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="清除搜尋與價格條件"
          onClick={() => {
            setText("");
            setLow("");
            setHigh("");
            onDirty(true);
            setOpen(true);
            input.current?.focus();
          }}
        >
          <X size={14} />
        </Button>
      </div>
      <div className="price-filters">
        <label>
          最低股價
          <input
            type="number"
            min="0"
            step="0.01"
            value={low}
            placeholder="不限"
            onChange={(e) => filter("low", e.target.value)}
          />
        </label>
        <span>—</span>
        <label>
          最高股價
          <input
            type="number"
            min="0"
            step="0.01"
            value={high}
            placeholder="不限"
            onChange={(e) => filter("high", e.target.value)}
          />
        </label>
      </div>
      {open && (
        <div className="search-popover">
          <div className="search-message" role="status">
            {result.error
              ? result.error.message
              : debounced !== search || result.isFetching
                ? "搜尋中…"
                : result.data
                  ? `找到 ${result.data.total} 檔${result.data.total > 20 ? "，先顯示 20 檔" : ""} · 最近收盤參考`
                  : "輸入代號或名稱搜尋"}
            {result.data?.sources.some((s) => s.status !== "available")
              ? " · 部分來源不可用或為舊快取"
              : ""}
          </div>
          <div id="stock-results" role="listbox" aria-label="股票搜尋結果">
            {items.map((item, i) => (
              <button
                key={item.symbol}
                id={"stock-option-" + i}
                data-result={i}
                role="option"
                aria-selected={active === i}
                className={active === i ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                <strong>
                  {item.symbol} {item.name}
                </strong>
                <b>{money(item.price)}</b>
                <small>
                  {item.exchange === "TPEx" ? "上櫃" : "上市"} · {item.as_of}
                </small>
                <small>{item.stale_cache ? "舊快取" : "收盤參考"}</small>
              </button>
            ))}
          </div>
          {result.data?.total === 0 && (
            <p className="search-message">
              沒有符合的普通股，請清除價格條件。本版不含 ETF、TDR 與權證。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
