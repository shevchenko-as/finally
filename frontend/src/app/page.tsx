"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Portfolio, PortfolioSnapshot, PriceUpdate, WatchlistItem } from "@/types";
import Header from "@/components/Header";
import WatchlistPanel from "@/components/WatchlistPanel";
import MainChart from "@/components/MainChart";
import PortfolioHeatmap from "@/components/PortfolioHeatmap";
import PnLChart from "@/components/PnLChart";
import PositionsTable from "@/components/PositionsTable";
import TradeBar from "@/components/TradeBar";
import ChatPanel from "@/components/ChatPanel";

type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export default function TradingTerminal() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const [sparklineData, setSparklineData] = useState<Record<string, number[]>>({});
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [chatOpen, setChatOpen] = useState(true);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- SSE ---
  const connectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    setConnectionStatus("reconnecting");

    const es = new EventSource("/api/stream/prices");
    esRef.current = es;

    es.onopen = () => setConnectionStatus("connected");

    es.onmessage = (e) => {
      try {
        const incoming: Record<string, PriceUpdate> = JSON.parse(e.data);
        setPrices((prev) => ({ ...prev, ...incoming }));
        setSparklineData((prev) => {
          const next = { ...prev };
          for (const [ticker, update] of Object.entries(incoming)) {
            const existing = next[ticker] ?? [];
            const updated = [...existing, update.price];
            next[ticker] = updated.length > 300 ? updated.slice(-300) : updated;
          }
          return next;
        });
        setConnectionStatus("connected");
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setConnectionStatus("reconnecting");
      es.close();
      esRef.current = null;
      reconnectTimerRef.current = setTimeout(connectSSE, 3000);
    };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connectSSE]);

  // --- Data fetchers ---
  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) setPortfolio(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio/history");
      if (res.ok) setHistory(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (res.ok) setWatchlist(await res.json());
    } catch { /* ignore */ }
  }, []);

  const refreshAll = useCallback(() => {
    fetchPortfolio();
    fetchHistory();
    fetchWatchlist();
  }, [fetchPortfolio, fetchHistory, fetchWatchlist]);

  // Initial load + polling
  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 10000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // --- Watchlist actions ---
  const handleAddTicker = async (ticker: string) => {
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      fetchWatchlist();
    } catch { /* ignore */ }
  };

  const handleRemoveTicker = async (ticker: string) => {
    try {
      await fetch(`/api/watchlist/${ticker}`, { method: "DELETE" });
      fetchWatchlist();
      if (selectedTicker === ticker) setSelectedTicker(null);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--color-bg-primary)" }}>
      {/* Header */}
      <Header portfolio={portfolio} connectionStatus={connectionStatus} />

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", gap: "4px", padding: "4px" }}>

        {/* Left: Watchlist */}
        <div style={{ width: "300px", minWidth: "260px", display: "flex", flexDirection: "column" }}>
          <WatchlistPanel
            watchlist={watchlist}
            prices={prices}
            sparklineData={sparklineData}
            selectedTicker={selectedTicker}
            onSelectTicker={setSelectedTicker}
            onAddTicker={handleAddTicker}
            onRemoveTicker={handleRemoveTicker}
          />
        </div>

        {/* Center: charts + bottom panels */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px", overflow: "hidden", minWidth: 0 }}>

          {/* Top row: main chart + heatmap */}
          <div style={{ flex: "0 0 260px", display: "flex", gap: "4px" }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <MainChart ticker={selectedTicker} sparklineData={sparklineData} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PortfolioHeatmap positions={portfolio?.positions ?? []} />
            </div>
          </div>

          {/* P&L chart */}
          <div style={{ flex: "0 0 180px" }}>
            <PnLChart history={history} />
          </div>

          {/* Positions table */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <PositionsTable positions={portfolio?.positions ?? []} />
          </div>

          {/* Trade bar */}
          <div style={{ flex: "0 0 auto" }}>
            <TradeBar
              selectedTicker={selectedTicker}
              onTradeComplete={refreshAll}
            />
          </div>
        </div>

        {/* Right: AI Chat */}
        <ChatPanel
          isOpen={chatOpen}
          onToggle={() => setChatOpen((v) => !v)}
          onPortfolioRefresh={refreshAll}
        />
      </div>
    </div>
  );
}
