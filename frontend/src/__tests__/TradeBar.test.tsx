import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import TradeBar from "@/components/TradeBar";

describe("TradeBar", () => {
  it("renders buy and sell buttons", () => {
    render(<TradeBar selectedTicker={null} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
  });

  it("renders ticker input when no selectedTicker", () => {
    render(<TradeBar selectedTicker={null} />);
    expect(screen.getByPlaceholderText("Ticker")).toBeInTheDocument();
  });

  it("shows selected ticker as a label and disables ticker input", () => {
    render(<TradeBar selectedTicker="AAPL" />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    const tickerInput = screen.getByPlaceholderText("AAPL") as HTMLInputElement;
    expect(tickerInput.disabled).toBe(true);
  });

  it("renders quantity input", () => {
    render(<TradeBar selectedTicker={null} />);
    expect(screen.getByPlaceholderText("Qty")).toBeInTheDocument();
  });

  it("shows validation error on empty trade", async () => {
    render(<TradeBar selectedTicker={null} />);
    fireEvent.click(screen.getByText("BUY"));
    expect(await screen.findByText(/valid ticker/i)).toBeInTheDocument();
  });
});
