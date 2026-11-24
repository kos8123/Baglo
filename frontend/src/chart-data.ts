import type { Bar, Period } from "./types.ts";
export function aggregate(bars: Bar[], period: Period): Bar[] {
  const groups = new Map<string, Bar>();
  for (const b of [...bars].sort((a, b) => a.date.localeCompare(b.date))) {
    let key = b.date;
    if (period === "week") {
      const d = new Date(b.date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = d.toISOString().slice(0, 10);
    } else if (period === "month") key = b.date.slice(0, 7);
    const old = groups.get(key);
    if (!old)
      groups.set(key, { ...b, period_start: b.date, period_end: b.date });
    else {
      old.high = Math.max(old.high, b.high);
      old.low = Math.min(old.low, b.low);
      old.close = b.close;
      old.period_end = b.date;
      old.volume =
        old.volume == null || b.volume == null ? null : old.volume + b.volume;
    }
  }
  return [...groups.values()];
}
export function snap(bars: Bar[], index: number) {
  const b = bars[Math.max(0, Math.min(bars.length - 1, index))];
  return b ? { date: b.date, price: b.close } : null;
}
