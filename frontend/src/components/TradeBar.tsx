"use client";

import React, { useState } from "react";
import { TradeResult } from "@/types";

interface TradeBarProps {
  selectedTicker: string | null;
  onTradeComplete?: () => void;
}

export default function TradeBar({ selectedTicker, onTradeComplete }: TradeBarProps) {
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const activeTicker = selectedTicker || ticker.trim().toUpperCase();

  const executeTrade = async (side: "buy" | "sell") => {
    const t = activeTicker;
    const qty = parseFloat(quantity);
    if (!t || isNaN(qty) || qty <= 0) {
      setResult({ ok: false, msg: "Enter a valid ticker and quantity" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/portfolio/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t, side, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, msg: data.detail ?? "Trade failed" });
      } else {
        const tr = data as TradeResult;
        setResult({
          ok: true,
          msg: `${side.toUpperCase()} ${tr.quantity} ${tr.ticker} @ $${tr.price.toFixed(2)} — cash: $${tr.cash_balance.toFixed(2)}`,
        });
        setQuantity("");
        onTradeComplete?.();
      }
    } catch {
      setResult({ ok: false, msg: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel" style={{ padding: "8px 12px" }}>
      <div className="panel-header" style={{ marginBottom: "8px", padding: 0, border: "none" }}>
        Trade Bar
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="terminal-input"
          style={{ width: "90px" }}
          placeholder={selectedTicker || "Ticker"}
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          disabled={!!selectedTicker}
        />
        {selectedTicker && (
          <span style={{ color: "var(--color-accent-gold)", fontWeight: 700, fontSize: "13px" }}>
            {selectedTicker}
          </span>
        )}
        <input
          className="terminal-input"
          style={{ width: "90px" }}
          type="number"
          placeholder="Qty"
          value={quantity}
          min="0"
          step="0.01"
          onChange={(e) => setQuantity(e.target.value)}
        />
        <button
          className="btn btn-buy"
          onClick={() => executeTrade("buy")}
          disabled={loading}
        >
          {loading ? "…" : "BUY"}
        </button>
        <button
          className="btn btn-sell"
          onClick={() => executeTrade("sell")}
          disabled={loading}
        >
          {loading ? "…" : "SELL"}
        </button>

        {result && (
          <span
            style={{
              fontSize: "11px",
              color: result.ok ? "var(--color-price-up)" : "var(--color-price-down)",
              marginLeft: "8px",
              flex: 1,
            }}
          >
            {result.ok ? "✓ " : "✗ "}{result.msg}
          </span>
        )}
      </div>
    </div>
  );
}
