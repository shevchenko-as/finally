"use client";

import React from "react";
import { Position } from "@/types";

interface PositionsTableProps {
  positions: Position[];
}

export default function PositionsTable({ positions }: PositionsTableProps) {
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Positions</span>
        <span style={{ color: "var(--color-text-muted)" }}>{positions.length} open</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {positions.length === 0 ? (
          <div style={{
            padding: "16px",
            color: "var(--color-text-muted)",
            fontSize: "12px",
            textAlign: "center",
          }}>
            No open positions — use the Trade Bar below to buy
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Qty</th>
                <th>Avg Cost</th>
                <th>Price</th>
                <th>Mkt Value</th>
                <th>Unr. P&L</th>
                <th>%</th>
                <th>Wt%</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const pnlColor = p.unrealized_pnl >= 0 ? "var(--color-price-up)" : "var(--color-price-down)";
                return (
                  <tr key={p.ticker}>
                    <td>
                      <span style={{ fontWeight: 700, color: "var(--color-accent-gold)" }}>
                        {p.ticker}
                      </span>
                    </td>
                    <td>{p.quantity.toFixed(2)}</td>
                    <td>{fmt(p.avg_cost)}</td>
                    <td>{fmt(p.current_price)}</td>
                    <td>{fmt(p.market_value)}</td>
                    <td style={{ color: pnlColor }}>
                      {p.unrealized_pnl >= 0 ? "+" : ""}{fmt(p.unrealized_pnl)}
                    </td>
                    <td style={{ color: pnlColor }}>
                      {p.unrealized_pnl_percent >= 0 ? "+" : ""}{p.unrealized_pnl_percent.toFixed(2)}%
                    </td>
                    <td style={{ color: "var(--color-text-muted)" }}>
                      {p.weight.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
