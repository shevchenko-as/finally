"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface MainChartProps {
  ticker: string | null;
  sparklineData: Record<string, number[]>;
}

export default function MainChart({ ticker, sparklineData }: MainChartProps) {
  const data = ticker ? (sparklineData[ticker] ?? []) : [];
  const chartData = data.map((price, i) => ({ i, price }));

  const min = data.length ? Math.min(...data) * 0.999 : 0;
  const max = data.length ? Math.max(...data) * 1.001 : 1;
  const last = data[data.length - 1];
  const first = data[0];
  const isUp = !first || last >= first;
  const color = isUp ? "var(--color-price-up)" : "var(--color-price-down)";

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{ticker ? `${ticker} — Price Chart` : "Select a ticker"}</span>
        {ticker && last && (
          <span style={{ color, fontWeight: 700 }}>${last.toFixed(2)}</span>
        )}
      </div>
      <div style={{ flex: 1, padding: "8px 4px 4px 0" }}>
        {chartData.length < 2 ? (
          <div style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-text-muted)",
            fontSize: "12px",
          }}>
            {ticker ? "Accumulating price data from SSE stream…" : "Click a ticker in the watchlist to view its chart"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis dataKey="i" hide />
              <YAxis
                domain={[min, max]}
                tickFormatter={(v) => `$${v.toFixed(0)}`}
                tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "4px",
                  fontSize: "11px",
                  color: "var(--color-text-primary)",
                }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [`$${Number(value).toFixed(2)}`, ticker ?? ""] as [string, string]}
                labelFormatter={() => ""}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={color}
                strokeWidth={1.5}
                fill="url(#chartGrad)"
                dot={false}
                activeDot={{ r: 3, fill: color }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
