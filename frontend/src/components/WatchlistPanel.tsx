"use client";

import React, { useEffect, useRef, useState } from "react";
import { WatchlistItem, PriceUpdate } from "@/types";
import Sparkline from "./Sparkline";

interface WatchlistPanelProps {
  watchlist: WatchlistItem[];
  prices: Record<string, PriceUpdate>;
  sparklineData: Record<string, number[]>;
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
  onAddTicker: (ticker: string) => void;
  onRemoveTicker: (ticker: string) => void;
}

export default function WatchlistPanel({
  watchlist,
  prices,
  sparklineData,
  selectedTicker,
  onSelectTicker,
  onAddTicker,
  onRemoveTicker,
}: WatchlistPanelProps) {
  const [addInput, setAddInput] = useState("");
  const [flashClasses, setFlashClasses] = useState<Record<string, string>>({});
  const prevPricesRef = useRef<Record<string, number>>({});

  // Trigger flash when prices update
  useEffect(() => {
    const newFlashes: Record<string, string> = {};
    for (const [ticker, update] of Object.entries(prices)) {
      const prev = prevPricesRef.current[ticker];
      if (prev !== undefined && prev !== update.price) {
        newFlashes[ticker] = update.price > prev ? "flash-up" : "flash-down";
      }
      prevPricesRef.current[ticker] = update.price;
    }
    if (Object.keys(newFlashes).length > 0) {
      setFlashClasses((prev) => ({ ...prev, ...newFlashes }));
      setTimeout(() => {
        setFlashClasses((prev) => {
          const next = { ...prev };
          for (const t of Object.keys(newFlashes)) delete next[t];
          return next;
        });
      }, 500);
    }
  }, [prices]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const t = addInput.trim().toUpperCase();
    if (t) {
      onAddTicker(t);
      setAddInput("");
    }
  };

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Watchlist</span>
        <span style={{ color: "var(--color-accent-gold)" }}>{watchlist.length} tickers</span>
      </div>

      {/* Add ticker form */}
      <form onSubmit={handleAdd} style={{ display: "flex", gap: "4px", padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>
        <input
          className="terminal-input"
          style={{ flex: 1 }}
          value={addInput}
          onChange={(e) => setAddInput(e.target.value.toUpperCase())}
          placeholder="Add ticker..."
          maxLength={8}
        />
        <button type="submit" className="btn btn-primary" style={{ padding: "5px 10px" }}>+</button>
      </form>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Ticker</th>
              <th>Price</th>
              <th>Chg%</th>
              <th>Chart</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((item) => {
              const livePrice = prices[item.ticker];
              const price = livePrice?.price ?? item.price;
              const changePct = livePrice?.change_percent ?? item.change_percent;
              const dir = livePrice?.direction ?? "flat";
              const isSelected = selectedTicker === item.ticker;

              return (
                <tr
                  key={item.ticker}
                  className={isSelected ? "selected" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectTicker(item.ticker)}
                >
                  <td>
                    <span
                      style={{
                        fontWeight: 700,
                        color: "var(--color-accent-gold)",
                        fontSize: "12px",
                      }}
                    >
                      {item.ticker}
                    </span>
                  </td>
                  <td>
                    <span className={flashClasses[item.ticker] ?? ""} style={{ display: "inline-block" }}>
                      <span className={dir === "up" ? "price-up" : dir === "down" ? "price-down" : "price-flat"}>
                        ${price.toFixed(2)}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={changePct >= 0 ? "price-up" : "price-down"}>
                      {changePct >= 0 ? "+" : ""}
                      {changePct.toFixed(2)}%
                    </span>
                  </td>
                  <td style={{ padding: "2px 8px" }}>
                    <Sparkline data={sparklineData[item.ticker] ?? [price]} width={70} height={24} />
                  </td>
                  <td style={{ padding: "2px 4px" }}>
                    <button
                      className="btn"
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        background: "transparent",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-muted)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveTicker(item.ticker);
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
