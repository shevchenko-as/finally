// Copy these into frontend/src/types/index.ts — do not drift from API contract

export interface PriceUpdate {
  ticker: string;
  price: number;
  previous_price: number;
  timestamp: number;
  change: number;
  change_percent: number;
  direction: "up" | "down" | "flat";
}

export interface WatchlistItem {
  ticker: string;
  added_at: string;
  price: number;
  change_percent: number;
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  weight: number;
}

export interface Portfolio {
  cash_balance: number;
  total_value: number;
  total_cost: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  positions: Position[];
}

export interface TradeResult {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
  cash_balance: number;
  executed_at: string;
}

export interface ChatResponse {
  message: string;
  trades_executed: Array<{ ticker: string; side: string; quantity: number; price: number }>;
  watchlist_changes: Array<{ ticker: string; action: string }>;
  errors: string[];
}

export interface PortfolioSnapshot {
  total_value: number;
  recorded_at: string;
}
