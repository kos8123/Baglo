import type { Instrument } from "./types.ts";
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll("臺", "台")
    .replace(/\.tw(o)?$/, "");
export function matchesInstrument(value: string, item: Instrument) {
  return [item.symbol, item.name, item.symbol + " " + item.name].some(
    (candidate) => normalize(candidate) === normalize(value),
  );
}
