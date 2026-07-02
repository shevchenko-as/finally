"""Tests for portfolio endpoints."""

import pytest


def test_get_portfolio_empty(client):
    """GET /api/portfolio with no positions."""
    response = client.get("/api/portfolio")
    assert response.status_code == 200
    data = response.json()
    assert data["cash_balance"] == 10000.0
    assert data["positions"] == []
    assert data["total_value"] == 10000.0
    assert data["unrealized_pnl"] == 0.0


def test_buy_happy_path(client):
    """BUY 5 AAPL at ~190.50."""
    response = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "side": "buy", "quantity": 5.0},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert data["side"] == "buy"
    assert data["quantity"] == 5.0
    assert data["price"] == 190.50
    assert data["total"] == pytest.approx(952.50, abs=0.01)
    assert data["cash_balance"] == pytest.approx(10000.0 - 952.50, abs=0.01)
    assert "executed_at" in data


def test_buy_insufficient_cash(client):
    """BUY should fail when cash is not enough."""
    response = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "side": "buy", "quantity": 100.0},
    )
    assert response.status_code == 400
    assert "Insufficient cash" in response.json()["detail"]


def test_buy_unknown_ticker(client):
    """BUY an unknown ticker (not in price cache) should return 400."""
    response = client.post(
        "/api/portfolio/trade",
        json={"ticker": "ZZZZ", "side": "buy", "quantity": 1.0},
    )
    assert response.status_code == 400


def test_sell_happy_path(client):
    """BUY then SELL AAPL."""
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 5.0})

    response = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "side": "sell", "quantity": 3.0},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["side"] == "sell"
    assert data["quantity"] == 3.0


def test_sell_insufficient_shares(client):
    """SELL more shares than owned should fail."""
    # Buy 2, then try to sell 5
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 2.0})
    response = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "side": "sell", "quantity": 5.0},
    )
    assert response.status_code == 400
    assert "Insufficient shares" in response.json()["detail"]


def test_sell_no_position(client):
    """SELL a ticker we don't own should fail."""
    response = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "side": "sell", "quantity": 1.0},
    )
    assert response.status_code == 400
    assert "Insufficient shares" in response.json()["detail"]


def test_portfolio_after_buy(client):
    """Portfolio reflects open position after a buy."""
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 10.0})
    data = client.get("/api/portfolio").json()
    assert len(data["positions"]) == 1
    pos = data["positions"][0]
    assert pos["ticker"] == "AAPL"
    assert pos["quantity"] == 10.0
    assert pos["market_value"] == pytest.approx(1905.0, abs=0.1)


def test_sell_all_removes_position(client):
    """Selling all shares removes the position."""
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 5.0})
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "sell", "quantity": 5.0})
    data = client.get("/api/portfolio").json()
    assert data["positions"] == []


def test_portfolio_history(client):
    """GET /api/portfolio/history returns list of snapshots."""
    # Execute a trade which triggers a snapshot
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 1.0})
    response = client.get("/api/portfolio/history")
    assert response.status_code == 200
    snapshots = response.json()
    assert isinstance(snapshots, list)
    assert len(snapshots) >= 1
    snap = snapshots[0]
    assert "total_value" in snap
    assert "recorded_at" in snap
