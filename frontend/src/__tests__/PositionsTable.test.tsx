import React from "react";
import { render, screen } from "@testing-library/react";
import PositionsTable from "@/components/PositionsTable";
import { Position } from "@/types";

const mockPositions: Position[] = [
  {
    ticker: "AAPL",
    quantity: 10,
    avg_cost: 185.0,
    current_price: 190.5,
    market_value: 1905.0,
    unrealized_pnl: 55.0,
    unrealized_pnl_percent: 2.97,
    weight: 18.61,
  },
  {
    ticker: "TSLA",
    quantity: 5,
    avg_cost: 200.0,
    current_price: 180.0,
    market_value: 900.0,
    unrealized_pnl: -100.0,
    unrealized_pnl_percent: -10.0,
    weight: 8.79,
  },
];

describe("PositionsTable", () => {
  it("renders empty state when no positions", () => {
    render(<PositionsTable positions={[]} />);
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument();
  });

  it("renders position tickers", () => {
    render(<PositionsTable positions={mockPositions} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("TSLA")).toBeInTheDocument();
  });

  it("shows correct position count", () => {
    render(<PositionsTable positions={mockPositions} />);
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    render(<PositionsTable positions={mockPositions} />);
    expect(screen.getByText("Ticker")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
  });
});
