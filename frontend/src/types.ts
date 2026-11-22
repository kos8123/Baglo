export type Venue = "board_lot" | "odd_lot";
export type Side = "buy" | "sell";
export type Period = "day" | "week" | "month";
export interface Instrument {
  symbol: string;
  name: string;
  exchange?: string;
  price?: number | null;
  as_of?: string;
  stale_cache?: boolean;
  price_limits?: Limits;
}
export interface Limits {
  status: string;
  lower?: number;
  upper?: number;
  reference?: number;
  as_of?: string;
  historical_session?: boolean;
  reason?: string;
}
export interface Quote {
  price: number | null;
  kind: string;
  source: string;
  as_of: string;
  fetched_at: string;
  reason: string;
  stale_cache: boolean;
  market_type: string;
}
export interface Market {
  instrument: Instrument;
  quote: Quote;
}
export interface Order {
  id: string;
  symbol: string;
  name?: string;
  side: Side;
  quantity: number;
  market_type?: Venue;
  limit_price: number;
  reserved: number;
  status: "pending" | "filled" | "cancelled";
  created_at: string;
  fee?: number;
  tax?: number;
  fill_price?: number;
}
export interface Account {
  cash: number;
  initial_cash: number;
  positions: Record<string, number>;
  orders: Order[];
  mode: string;
}
export interface Config {
  environment: string;
  demo: boolean;
  client_id: string;
  auth_domain: string;
  symbols: Instrument[];
  price_ticks: { below: number | null; tick: number }[];
  capabilities: Record<string, boolean>;
}
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  period_start?: string;
  period_end?: string;
}
export interface History {
  bars: Bar[];
  source: string;
  status: string;
  sma20: number | null;
  sma60: number | null;
  warnings: string[];
  as_of: string | null;
  note: string;
}
export interface SearchResult {
  items: Instrument[];
  total: number;
  sources: { source: string; status: string }[];
}
export interface Revenue {
  period: string;
  report_date: string;
  yoy_percent: number | null;
  mom_percent: number | null;
  stale_cache?: boolean;
}
export interface Valuation {
  pe: number | null;
  pb: number | null;
  dividend_yield_percent: number | null;
  as_of: string;
  stale_cache?: boolean;
}
export interface Ownership {
  status: string;
  source: string;
  as_of?: string;
  foreign_net_shares: number | null;
  trust_net_shares: number | null;
  dealer_net_shares: number | null;
  total_net_shares: number | null;
  note?: string;
  reason?: string;
  stale_cache?: boolean;
}
export interface Research {
  fundamentals: {
    source: string;
    revenue: Revenue | null;
    valuation: Valuation | null;
  };
  ownership: Ownership;
}
export interface OrderBody {
  symbol: string;
  side: Side;
  quantity: number;
  market_type: Venue;
  limit_price: number;
}
