import React from "react";
import { render, screen } from "@testing-library/react";
import Header from "@/components/Header";
import { Portfolio } from "@/types";

const mockPortfolio: Portfolio = {
  cash_balance: 8500.0,
  total_value: 10234.5,
  total_cost: 9800.0,
  unrealized_pnl: 434.5,
  unrealized_pnl_percent: 4.43,
  positions: [],
};

describe("Header", () => {
  it("renders FINALLY logo", () => {
    render(<Header portfolio={null} connectionStatus="connected" />);
    expect(screen.getByText("FIN")).toBeInTheDocument();
    expect(screen.getByText("ALLY")).toBeInTheDocument();
  });

  it("shows portfolio value when provided", () => {
    render(<Header portfolio={mockPortfolio} connectionStatus="connected" />);
    expect(screen.getByText("$10,234.50")).toBeInTheDocument();
  });

  it("shows cash balance", () => {
    render(<Header portfolio={mockPortfolio} connectionStatus="connected" />);
    expect(screen.getByText("$8,500.00")).toBeInTheDocument();
  });

  it("shows LIVE status when connected", () => {
    render(<Header portfolio={null} connectionStatus="connected" />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("shows OFFLINE status when disconnected", () => {
    render(<Header portfolio={null} connectionStatus="disconnected" />);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });

  it("shows RECONNECTING status when reconnecting", () => {
    render(<Header portfolio={null} connectionStatus="reconnecting" />);
    expect(screen.getByText("RECONNECTING")).toBeInTheDocument();
  });

  it("shows dashes when no portfolio data", () => {
    render(<Header portfolio={null} connectionStatus="connected" />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });
});
