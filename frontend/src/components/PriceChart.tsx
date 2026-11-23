import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type LogicalRange,
} from "lightweight-charts";
import { Minus, Plus, RotateCcw, Expand } from "lucide-react";
import { money } from "../lib";
import { aggregate } from "../chart-data";
import type { Bar, Period } from "../types";
import { Button } from "./ui/button";
import { tr } from "../language";
const names = { day: "日 K", week: "週 K", month: "月 K" };
const defaultCounts: Record<Period, number> = { day: 1260, week: 416, month: 120 };
const chartDate = (value: Time | undefined): string => {
  if (value == null) return "—";
  if (typeof value === "string") return value.replaceAll("-", "/");
  if (typeof value === "number") return new Date(value * 1000).toISOString().slice(0, 10).replaceAll("-", "/");
  return `${value.year}/${String(value.month).padStart(2, "0")}/${String(value.day).padStart(2, "0")}`;
};
const lots = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(value);
export function PriceChart({
  symbol,
  bars,
  loading,
  error,
  range,
  onOlder,
  canOlder,
  olderLoading,
  warnings,
}: {
  symbol: string;
  bars: Bar[];
  loading: boolean;
  error?: string;
  range: string;
  onOlder: () => void;
  canOlder: boolean;
  olderLoading: boolean;
  warnings: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null),
    series = useRef<ISeriesApi<"Candlestick"> | null>(null),
    volume = useRef<ISeriesApi<"Histogram"> | null>(null),
    userView = useRef(false),
    lookup = useRef(new Map<string, Bar>());
  const [period, setPeriod] = useState<Period>("day"),
    [readout, setReadout] = useState<Bar | null>(null);
  const data = useMemo(() => aggregate(bars, period), [bars, period]);
  useEffect(() => {
    if (!host.current) return;
    userView.current = false;
    setReadout(null);
    const instance = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#1c2229" },
        textColor: "#94a3b8",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#ffffff06" },
        horzLines: { color: "#ffffff09" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#9bafc5", labelBackgroundColor: "#526274" },
        horzLine: { color: "#9bafc5", labelBackgroundColor: "#526274" },
      },
      rightPriceScale: { borderColor: "#303a46", minimumWidth: 76 },
      timeScale: {
        borderColor: "#303a46",
        rightOffset: 0,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time) => chartDate(time),
      },
      localization: { locale: "zh-TW", timeFormatter: chartDate },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });
    const candles = instance.addSeries(CandlestickSeries, {
      upColor: "#ef777b",
      downColor: "#58c4a1",
      borderVisible: false,
      wickUpColor: "#ef777b",
      wickDownColor: "#58c4a1",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    const volumes = instance.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "custom", minMove: 0.001, formatter: (value: number) => `${lots(value)} 張` },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    instance.panes()[1]?.setHeight(85);
    chart.current = instance;
    series.current = candles;
    volume.current = volumes;
    instance.subscribeCrosshairMove((param) => {
      if (!param.time) return;
      const t = param.time;
      const key =
        typeof t === "string"
          ? t
          : typeof t === "number"
            ? new Date(t * 1000).toISOString().slice(0, 10)
            : `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
      const b = lookup.current.get(key);
      if (b) setReadout(b);
    });
    return () => {
      instance.remove();
      chart.current = null;
      series.current = null;
      volume.current = null;
    };
  }, [symbol, period]);
  useEffect(() => {
    if (!chart.current || !series.current || !volume.current) return;
    const hasData = data.length > 0;
    chart.current.applyOptions({
      handleScroll: hasData
        ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }
        : false,
      handleScale: hasData
        ? { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
        : false,
    });
    const prior = chart.current.timeScale().getVisibleRange();
    lookup.current = new Map(data.map((b) => [b.date, b]));
    series.current.setData(
      data.map((b) => ({
        time: b.date as Time,
        open: b.open / 100,
        high: b.high / 100,
        low: b.low / 100,
        close: b.close / 100,
      })),
    );
    volume.current.setData(
      data
        .filter((b) => b.volume != null)
        .map((b) => ({
          time: b.date as Time,
          value: b.volume! / 1000,
          color: b.close >= b.open ? "#ef777b55" : "#58c4a155",
        })),
    );
    setReadout(data.at(-1) || null);
    if (hasData) {
      if (userView.current && prior)
        chart.current.timeScale().setVisibleRange(prior);
      else {
        const count = defaultCounts[period];
        if (Number.isFinite(count))
          chart.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, data.length - count) - 0.5,
            to: data.length + 2,
          });
        else chart.current.timeScale().fitContent();
      }
    } else chart.current.timeScale().resetTimeScale();
  }, [data, symbol, period]);
  const zoom = (factor: number) => {
    const instance = chart.current;
    if (!instance || !data.length) return;
    const r = instance.timeScale().getVisibleLogicalRange();
    if (!r) return;
    userView.current = true;
    const width = Math.max(8, (r.to - r.from) * factor);
    instance
      .timeScale()
      .setVisibleLogicalRange({ from: r.to - width, to: r.to } as LogicalRange);
  };
  const reset = () => {
    userView.current = false;
    const count = defaultCounts[period];
    if (Number.isFinite(count))
      chart.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, data.length - count) - 0.5,
        to: data.length + 2,
      });
    else chart.current?.timeScale().fitContent();
  };
  return (
    <section className="chart-panel">
      <div className="chart-toolbar">
        <div className="segmented" aria-label="K 線週期">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <Button
              key={p}
              variant="ghost"
              aria-pressed={period === p}
              className={period === p ? "selected" : ""}
              onClick={() => setPeriod(p)}
            >
              {tr(names[p])}
            </Button>
          ))}
        </div>
        <div className="chart-controls">
          <Button
            variant="ghost"
            size="icon"
            aria-label="放大 K 線"
            disabled={!data.length}
            onClick={() => zoom(0.8)}
          >
            <Plus size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="縮小 K 線"
            disabled={!data.length}
            onClick={() => zoom(1.25)}
          >
            <Minus size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="重設 K 線"
            disabled={!data.length}
            onClick={reset}
          >
            <RotateCcw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="顯示全部歷史"
            disabled={!data.length}
            onClick={() => {
              userView.current = true;
              chart.current?.timeScale().fitContent();
            }}
          >
            <Expand size={14} />
          </Button>
        </div>
        <span className="source-note">{tr("未還原價格 · 紅漲綠跌")}</span>
      </div>
      <div className="ohlc" aria-live="off">
        {readout ? (
          <>
            <span>
              {period === "day"
                ? chartDate(readout.date)
                : `${chartDate(readout.period_start)} ～ ${chartDate(readout.period_end)}`}
            </span>
            {[
              ["開", readout.open],
              ["高", readout.high],
              ["低", readout.low],
              ["收", readout.close],
            ].map(([label, value]) => (
              <span key={label}>
                <small>{tr(label as string)}</small> {money(value as number)}
              </span>
            ))}
            <span>
              <small>{tr("量")}</small>{" "}
              {readout.volume == null ? "—" : lots(readout.volume / 1000)}{" "}
              {tr("張")}
            </span>
          </>
        ) : (
          <span>
            {loading ? "正在載入官方歷史資料…" : error || "暫無可用日線"}
          </span>
        )}
      </div>
      <div
        className="chart-surface"
        ref={host}
        role="img"
        aria-label={`${symbol} ${names[period]}，${data.length} 根 K 棒`}
        onWheel={() => {
          if (data.length) userView.current = true;
        }}
        onPointerDown={() => {
          if (data.length) userView.current = true;
        }}
      />
      <div className="chart-footer">
        <span>
          {range || "等待歷史資料"}
          {warnings ? " · 部分月份缺漏或為快取" : ""}
          {period !== "day" ? " · 首末週／月可能不完整" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canOlder || olderLoading}
          onClick={onOlder}
        >
          {olderLoading
            ? "載入歷史中…"
            : canOlder
              ? "載入更早資料"
              : "已達十年範圍"}
        </Button>
      </div>
      {error && (
        <div className="inline-error">{error}，可點載入更早資料重試。</div>
      )}
    </section>
  );
}
