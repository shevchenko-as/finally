"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChatResponse } from "@/types";

interface Message {
  role: "user" | "assistant";
  content: string;
  trades?: ChatResponse["trades_executed"];
  watchlist_changes?: ChatResponse["watchlist_changes"];
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onPortfolioRefresh: () => void;
}

export default function ChatPanel({ isOpen, onToggle, onPortfolioRefresh }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm FinAlly, your AI trading assistant. I can analyze your portfolio, suggest trades, and execute them on your behalf. What would you like to do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data: ChatResponse = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message,
          trades: data.trades_executed,
          watchlist_changes: data.watchlist_changes,
        },
      ]);

      if ((data.trades_executed?.length ?? 0) > 0 || (data.watchlist_changes?.length ?? 0) > 0) {
        onPortfolioRefresh();
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered a network error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: isOpen ? "320px" : "40px",
        minWidth: isOpen ? "320px" : "40px",
        transition: "width 0.2s ease, min-width 0.2s ease",
        borderLeft: "1px solid var(--color-border)",
        background: "var(--color-bg-secondary)",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        style={{
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          padding: "10px",
          cursor: "pointer",
          color: "var(--color-accent-gold)",
          fontSize: "14px",
          textAlign: isOpen ? "right" : "center",
          fontFamily: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          justifyContent: isOpen ? "space-between" : "center",
        }}
      >
        {isOpen && (
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            AI Assistant
          </span>
        )}
        <span style={{ fontSize: "16px" }}>{isOpen ? "›" : "‹"}</span>
      </button>

      {isOpen && (
        <>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: "10px" }}>
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: m.role === "user" ? "var(--color-accent-gold)" : "var(--color-accent-green)",
                    marginBottom: "3px",
                  }}
                >
                  {m.role === "user" ? "YOU" : "FINALLY AI"}
                </div>
                <div
                  style={{
                    background: m.role === "user" ? "var(--color-bg-primary)" : "#0f2027",
                    border: `1px solid ${m.role === "user" ? "var(--color-border)" : "#1a3a2e"}`,
                    borderRadius: "4px",
                    padding: "8px",
                    fontSize: "12px",
                    lineHeight: "1.5",
                    color: "var(--color-text-primary)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>

                {/* Trade chips */}
                {m.trades && m.trades.length > 0 && (
                  <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {m.trades.map((t, ti) => (
                      <span
                        key={ti}
                        style={{
                          background: t.side === "buy" ? "#de980222" : "#f8514922",
                          border: `1px solid ${t.side === "buy" ? "var(--color-accent-orange)" : "var(--color-price-down)"}`,
                          borderRadius: "3px",
                          padding: "2px 6px",
                          fontSize: "10px",
                          color: t.side === "buy" ? "var(--color-accent-orange)" : "var(--color-price-down)",
                          fontWeight: 700,
                        }}
                      >
                        {t.side.toUpperCase()} {t.quantity} {t.ticker} @ ${t.price?.toFixed(2) ?? "—"}
                      </span>
                    ))}
                  </div>
                )}

                {/* Watchlist chips */}
                {m.watchlist_changes && m.watchlist_changes.length > 0 && (
                  <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {m.watchlist_changes.map((w, wi) => (
                      <span
                        key={wi}
                        style={{
                          background: "#ecad0a22",
                          border: "1px solid var(--color-accent-gold)",
                          borderRadius: "3px",
                          padding: "2px 6px",
                          fontSize: "10px",
                          color: "var(--color-accent-gold)",
                          fontWeight: 700,
                        }}
                      >
                        {w.action.toUpperCase()} {w.ticker} watchlist
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: "var(--color-accent-green)", marginBottom: "3px" }}>
                  FINALLY AI
                </div>
                <div style={{
                  background: "#0f2027",
                  border: "1px solid #1a3a2e",
                  borderRadius: "4px",
                  padding: "8px",
                  display: "flex",
                  gap: "4px",
                  alignItems: "center",
                }}>
                  <span style={{ color: "var(--color-accent-green)", animation: "dots 1.2s infinite" }}>●</span>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>Thinking…</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={sendMessage}
            style={{
              padding: "8px",
              borderTop: "1px solid var(--color-border)",
              display: "flex",
              gap: "6px",
            }}
          >
            <input
              className="terminal-input"
              style={{ flex: 1, fontSize: "12px" }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask FinAlly…"
              disabled={loading}
            />
            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: "5px 10px" }}
              disabled={loading || !input.trim()}
            >
              {loading ? "…" : "→"}
            </button>
          </form>
        </>
      )}

      <style>{`
        @keyframes dots {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
