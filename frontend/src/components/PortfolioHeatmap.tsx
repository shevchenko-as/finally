"use client";

import React, { useMemo } from "react";
import { Position } from "@/types";

interface PortfolioHeatmapProps {
  positions: Position[];
}

interface TreemapRect {
  ticker: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pnl: number;
  pnlPct: number;
  weight: number;
}

function squarify(
  items: { ticker: string; weight: number; pnl: number; pnlPct: number }[],
  x: number,
  y: number,
  w: number,
  h: number
): TreemapRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ ...items[0], x, y, w, h }];
  }
  // Simple slice-and-dice treemap
  const total = items.reduce((s, i) => s + i.weight, 0);
  const rects: TreemapRect[] = [];
  let cx = x;
  for (const item of items) {
    const fw = (item.weight / total) * w;
    rects.push({ ...item, x: cx, y, w: fw, h });
    cx += fw;
  }
  return rects;
}

function pnlToColor(pnlPct: number): string {
  if (pnlPct > 5) return "#02de02cc";
  if (pnlPct > 2) return "#02de0299";
  if (pnlPct > 0) return "#02de0255";
  if (pnlPct > -2) return "#f8514955";
  if (pnlPct > -5) return "#f8514999";
  return "#f85149cc";
}

export default function PortfolioHeatmap({ positions }: PortfolioHeatmapProps) {
  const W = 400;
  const H = 160;

  const items = useMemo(
    () =>
      positions
        .filter((p) => p.weight > 0)
        .map((p) => ({
          ticker: p.ticker,
          weight: p.weight,
          pnl: p.unrealized_pnl,
          pnlPct: p.unrealized_pnl_percent,
        }))
        .sort((a, b) => b.weight - a.weight),
    [positions]
  );

  const rects = squarify(items, 0, 0, W, H);

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="panel-header">Portfolio Heatmap</div>
      <div style={{ flex: 1, padding: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {positions.length === 0 ? (
          <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>No positions yet</span>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block", maxHeight: 180 }}>
            {rects.map((r) => (
              <g key={r.ticker}>
                <rect
                  x={r.x + 1}
                  y={r.y + 1}
                  width={Math.max(0, r.w - 2)}
                  height={Math.max(0, r.h - 2)}
                  fill={pnlToColor(r.pnlPct)}
                  rx={3}
                  stroke="var(--color-bg-primary)"
                  strokeWidth={1}
                />
                {r.w > 40 && r.h > 24 && (
                  <>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 - 6}
                      textAnchor="middle"
                      fontSize={Math.min(14, r.w / 4)}
                      fontWeight={700}
                      fill="var(--color-text-primary)"
                      fontFamily="monospace"
                    >
                      {r.ticker}
                    </text>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + 10}
                      textAnchor="middle"
                      fontSize={Math.min(11, r.w / 5)}
                      fill={r.pnlPct >= 0 ? "var(--color-price-up)" : "var(--color-price-down)"}
                      fontFamily="monospace"
                    >
                      {r.pnlPct >= 0 ? "+" : ""}{r.pnlPct.toFixed(1)}%
                    </text>
                  </>
                )}
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
