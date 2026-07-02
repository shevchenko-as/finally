"""Tests for POST /api/chat."""

from unittest.mock import patch, AsyncMock

from app.llm import LLMResponse, TradeAction, WatchlistChange


def test_chat_basic_mock_response(client):
    """Chat returns a message when LLM_MOCK=true."""
    import os
    os.environ["LLM_MOCK"] = "true"
    try:
        response = client.post("/api/chat", json={"message": "Hello"})
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert isinstance(data["trades_executed"], list)
        assert isinstance(data["watchlist_changes"], list)
        assert isinstance(data["errors"], list)
    finally:
        os.environ.pop("LLM_MOCK", None)


def test_chat_saves_to_db(client):
    """User and assistant messages are persisted in DB."""
    import os
    from app.db import get_chat_history
    os.environ["LLM_MOCK"] = "true"
    try:
        client.post("/api/chat", json={"message": "Test message"})
        history = get_chat_history()
        roles = [msg["role"] for msg in history]
        assert "user" in roles
        assert "assistant" in roles
    finally:
        os.environ.pop("LLM_MOCK", None)


def test_chat_auto_executes_trades(client, price_cache):
    """Chat auto-executes trades returned by LLM."""
    mock_response = LLMResponse(
        message="Buying 2 NVDA for you.",
        trades=[TradeAction(ticker="NVDA", side="buy", quantity=2.0)],
        watchlist_changes=[],
    )
    with patch("app.api.chat.chat_completion", new=AsyncMock(return_value=mock_response)):
        response = client.post("/api/chat", json={"message": "Buy NVDA"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["trades_executed"]) == 1
    trade = data["trades_executed"][0]
    assert trade["ticker"] == "NVDA"
    assert trade["side"] == "buy"
    assert trade["quantity"] == 2.0
    assert data["errors"] == []


def test_chat_trade_error_captured(client):
    """Trade errors (e.g., insufficient cash) are captured in errors list."""
    mock_response = LLMResponse(
        message="Trying to buy a ton of AAPL.",
        trades=[TradeAction(ticker="AAPL", side="buy", quantity=99999.0)],
        watchlist_changes=[],
    )
    with patch("app.api.chat.chat_completion", new=AsyncMock(return_value=mock_response)):
        response = client.post("/api/chat", json={"message": "Buy a lot"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["errors"]) >= 1
    assert "Insufficient" in data["errors"][0]


def test_chat_auto_watchlist_add(client, mock_market_source):
    """Chat auto-adds tickers to watchlist."""
    mock_response = LLMResponse(
        message="Added SHOP to your watchlist.",
        trades=[],
        watchlist_changes=[WatchlistChange(ticker="SHOP", action="add")],
    )
    with patch("app.api.chat.chat_completion", new=AsyncMock(return_value=mock_response)):
        response = client.post("/api/chat", json={"message": "Watch SHOP"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["watchlist_changes"]) == 1
    assert data["watchlist_changes"][0]["ticker"] == "SHOP"
    mock_market_source.add_ticker.assert_awaited_once_with("SHOP")


def test_chat_llm_failure_returns_500(client):
    """LLM service failure maps to HTTP 500."""
    with patch("app.api.chat.chat_completion", new=AsyncMock(side_effect=Exception("API down"))):
        response = client.post("/api/chat", json={"message": "Hello"})
    assert response.status_code == 500
    assert "unavailable" in response.json()["detail"]
