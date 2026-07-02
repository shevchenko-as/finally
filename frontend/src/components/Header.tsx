"use client";

import React from "react";
import { Portfolio } from "@/types";

type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

interface HeaderProps {
  portfolio: Portfolio | null;
  connectionStatus: ConnectionStatus;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: "#02de02",
  reconnecting: "#ecad0a",
  disconnected: "#f85149",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "LIVE",
  reconnecting: "RECONNECTING",
  disconnected: "OFFLINE",
};

export default function Header({ portfolio, connectionStatus }: HeaderProps) {
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

  const pnlColor =
    portfolio && portfolio.unrealized_pnl >= 0 ? "var(--color-price-up)" : "var(--color-price-down)";

  return (
    <header
      style={{
        background: "var(--color-bg-secondary)",
        borderBottom: "1px solid var(--color-border)",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "24px",
        height: "44px",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "120px" }}>
        <span
          style={{
            color: "var(--color-accent-gold)",
            fontWeight: 800,
            fontSize: "16px",
            letterSpacing: "0.1em",
          }}
        >
          FIN
        </span>
        <span style={{ color: "var(--color-text-muted)", fontSize: "16px", fontWeight: 300 }}>
          ALLY
        </span>
      </div>

      <div style={{ width: "1px", height: "24px", background: "var(--color-border)" }} />

      {/* Portfolio value */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Portfolio Value
        </span>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          {portfolio ? fmt(portfolio.total_value) : "—"}
        </span>
      </div>

      {/* Cash balance */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Cash
        </span>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-accent-gold)" }}>
          {portfolio ? fmt(portfolio.cash_balance) : "—"}
        </span>
      </div>

      {/* Unrealized P&L */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Unrealized P&L
        </span>
        <span style={{ fontSize: "15px", fontWeight: 700, color: pnlColor }}>
          {portfolio
            ? `${portfolio.unrealized_pnl >= 0 ? "+" : ""}${fmt(portfolio.unrealized_pnl)} (${portfolio.unrealized_pnl_percent >= 0 ? "+" : ""}${portfolio.unrealized_pnl_percent.toFixed(2)}%)`
            : "—"}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: STATUS_COLORS[connectionStatus],
            boxShadow: `0 0 6px ${STATUS_COLORS[connectionStatus]}`,
            animation: connectionStatus === "reconnecting" ? "pulse 1s infinite" : undefined,
          }}
        />
        <span style={{ fontSize: "11px", color: STATUS_COLORS[connectionStatus], fontWeight: 600, letterSpacing: "0.05em" }}>
          {STATUS_LABELS[connectionStatus]}
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </header>
  );
}
