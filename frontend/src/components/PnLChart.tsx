"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { PortfolioSnapshot } from "@/types";

interface PnLChartProps {
  history: PortfolioSnapshot[];
}

export default function PnLChart({ history }: PnLChartProps) {
  const data = history.map((s) => ({
    time: new Date(s.recorded_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    value: s.total_value,
  }));

  const first = data[0]?.value ?? 10000;
  const last = data[data.length - 1]?.value ?? first;
  const isUp = last >= first;
  const color = isUp ? "var(--color-price-up)" : "var(--color-price-down)";
  const min = data.length ? Math.min(...data.map((d) => d.value)) * 0.998 : 9900;
  const max = data.length ? Math.max(...data.map((d) => d.value)) * 1.002 : 10100;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Portfolio P&L</span>
        {data.length > 0 && (
          <span style={{ color, fontWeight: 700 }}>
            {isUp ? "+" : ""}{((last - first) / first * 100).toFixed(2)}%
          </span>
        )}
      </div>
      <div style={{ flex: 1, padding: "8px 4px 4px 0" }}>
        {data.length < 2 ? (
          <div style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-text-muted)",
            fontSize: "12px",
          }}>
            Waiting for portfolio history…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "var(--color-text-muted)", fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[min, max]}
                tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={48}
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
                formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Value"] as [string, string]}
              />
              <ReferenceLine y={first} stroke="var(--color-border)" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: color }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
