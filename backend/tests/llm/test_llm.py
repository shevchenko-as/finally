"""Unit tests for backend/app/llm."""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.llm import (
    LLMResponse,
    TradeAction,
    WatchlistChange,
    chat_completion,
    _parse_llm_json,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PORTFOLIO_CONTEXT = {
    "cash_balance": 8500.00,
    "total_value": 10234.50,
    "unrealized_pnl": 434.50,
    "positions": [
        {
            "ticker": "AAPL",
            "quantity": 10.0,
            "avg_cost": 185.00,
            "current_price": 190.50,
            "unrealized_pnl": 55.00,
        }
    ],
    "watchlist": ["AAPL", "GOOGL", "MSFT"],
}

CHAT_HISTORY: list[dict] = [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": json.dumps({"message": "Hi! How can I help?", "trades": [], "watchlist_changes": []})},
]


# ---------------------------------------------------------------------------
# Mock mode
# ---------------------------------------------------------------------------

class TestMockMode:
    """When LLM_MOCK=true, chat_completion must not call the API."""

    @pytest.mark.asyncio
    async def test_mock_returns_deterministic_response(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "true")
        with patch("app.llm.litellm.acompletion") as mock_call:
            result = await chat_completion("Hello", PORTFOLIO_CONTEXT, [])

        mock_call.assert_not_called()
        assert isinstance(result, LLMResponse)
        assert result.message == "[MOCK] I'm the FinAlly AI assistant. How can I help?"
        assert result.trades == []
        assert result.watchlist_changes == []

    @pytest.mark.asyncio
    async def test_mock_ignores_user_message(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "true")
        with patch("app.llm.litellm.acompletion"):
            result1 = await chat_completion("Buy AAPL", PORTFOLIO_CONTEXT, [])
            result2 = await chat_completion("What is my balance?", PORTFOLIO_CONTEXT, [])

        assert result1.message == result2.message

    @pytest.mark.asyncio
    async def test_mock_false_calls_api(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "false")
        monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

        payload = json.dumps({"message": "Sure!", "trades": [], "watchlist_changes": []})
        fake_choice = MagicMock()
        fake_choice.message.content = payload
        fake_response = MagicMock()
        fake_response.choices = [fake_choice]

        with patch("app.llm.litellm.acompletion", new=AsyncMock(return_value=fake_response)) as mock_call:
            result = await chat_completion("Hello", PORTFOLIO_CONTEXT, [])

        mock_call.assert_called_once()
        assert result.message == "Sure!"


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

class TestParseJsonResponse:
    def test_valid_full_response(self):
        raw = json.dumps({
            "message": "Bought 5 shares of NVDA.",
            "trades": [{"ticker": "NVDA", "side": "buy", "quantity": 5}],
            "watchlist_changes": [{"ticker": "PYPL", "action": "add"}],
        })
        result = _parse_llm_json(raw)

        assert result.message == "Bought 5 shares of NVDA."
        assert len(result.trades) == 1
        assert result.trades[0] == TradeAction(ticker="NVDA", side="buy", quantity=5.0)
        assert len(result.watchlist_changes) == 1
        assert result.watchlist_changes[0] == WatchlistChange(ticker="PYPL", action="add")

    def test_valid_message_only(self):
        raw = json.dumps({"message": "Your portfolio looks balanced.", "trades": [], "watchlist_changes": []})
        result = _parse_llm_json(raw)
        assert result.message == "Your portfolio looks balanced."
        assert result.trades == []
        assert result.watchlist_changes == []

    def test_missing_optional_fields_defaults_to_empty(self):
        raw = json.dumps({"message": "Hello!"})
        result = _parse_llm_json(raw)
        assert result.message == "Hello!"
        assert result.trades == []
        assert result.watchlist_changes == []

    def test_malformed_json_returns_error_message(self):
        result = _parse_llm_json("this is not json {{{")
        assert "Error" in result.message
        assert result.trades == []
        assert result.watchlist_changes == []

    def test_missing_message_field_returns_error(self):
        raw = json.dumps({"trades": [], "watchlist_changes": []})
        result = _parse_llm_json(raw)
        assert "Error" in result.message

    def test_empty_string_returns_error(self):
        result = _parse_llm_json("")
        assert "Error" in result.message

    def test_malformed_trade_entry_is_skipped(self):
        """A trade entry missing required fields should be silently skipped."""
        raw = json.dumps({
            "message": "Done.",
            "trades": [
                {"ticker": "AAPL", "side": "buy", "quantity": 10},  # valid
                {"ticker": "GOOG"},  # missing side and quantity — skip
                {"side": "sell", "quantity": 5},  # missing ticker — skip
            ],
            "watchlist_changes": [],
        })
        result = _parse_llm_json(raw)
        assert result.message == "Done."
        assert len(result.trades) == 1
        assert result.trades[0].ticker == "AAPL"

    def test_malformed_watchlist_entry_is_skipped(self):
        raw = json.dumps({
            "message": "Updated.",
            "trades": [],
            "watchlist_changes": [
                {"ticker": "TSLA", "action": "add"},  # valid
                {"ticker": "MSFT"},  # missing action — skip
            ],
        })
        result = _parse_llm_json(raw)
        assert len(result.watchlist_changes) == 1
        assert result.watchlist_changes[0] == WatchlistChange(ticker="TSLA", action="add")


# ---------------------------------------------------------------------------
# Dataclass correctness
# ---------------------------------------------------------------------------

class TestDataclasses:
    def test_trade_action_fields(self):
        t = TradeAction(ticker="NVDA", side="sell", quantity=3.5)
        assert t.ticker == "NVDA"
        assert t.side == "sell"
        assert t.quantity == 3.5

    def test_watchlist_change_fields(self):
        w = WatchlistChange(ticker="META", action="remove")
        assert w.ticker == "META"
        assert w.action == "remove"

    def test_llm_response_defaults(self):
        r = LLMResponse(message="Hi")
        assert r.trades == []
        assert r.watchlist_changes == []

    def test_llm_response_mutable_defaults_are_independent(self):
        r1 = LLMResponse(message="A")
        r2 = LLMResponse(message="B")
        r1.trades.append(TradeAction("X", "buy", 1))
        assert r2.trades == []


# ---------------------------------------------------------------------------
# Integration: chat_completion with mocked litellm
# ---------------------------------------------------------------------------

class TestChatCompletion:
    @pytest.mark.asyncio
    async def test_passes_chat_history_to_model(self, monkeypatch):
        monkeypatch.delenv("LLM_MOCK", raising=False)
        monkeypatch.setenv("OPENROUTER_API_KEY", "key")

        payload = json.dumps({"message": "OK", "trades": [], "watchlist_changes": []})
        fake_choice = MagicMock()
        fake_choice.message.content = payload
        fake_response = MagicMock()
        fake_response.choices = [fake_choice]

        with patch("app.llm.litellm.acompletion", new=AsyncMock(return_value=fake_response)) as mock_call:
            await chat_completion("What should I buy?", PORTFOLIO_CONTEXT, CHAT_HISTORY)

        call_messages = mock_call.call_args.kwargs["messages"]
        roles = [m["role"] for m in call_messages]
        assert roles[0] == "system"
        assert "user" in roles
        assert "assistant" in roles
        # Last message must be the new user message
        assert call_messages[-1] == {"role": "user", "content": "What should I buy?"}

    @pytest.mark.asyncio
    async def test_portfolio_context_in_system_prompt(self, monkeypatch):
        monkeypatch.delenv("LLM_MOCK", raising=False)
        monkeypatch.setenv("OPENROUTER_API_KEY", "key")

        payload = json.dumps({"message": "OK", "trades": [], "watchlist_changes": []})
        fake_choice = MagicMock()
        fake_choice.message.content = payload
        fake_response = MagicMock()
        fake_response.choices = [fake_choice]

        with patch("app.llm.litellm.acompletion", new=AsyncMock(return_value=fake_response)) as mock_call:
            await chat_completion("Hello", PORTFOLIO_CONTEXT, [])

        system_content = mock_call.call_args.kwargs["messages"][0]["content"]
        assert "8500" in system_content  # cash_balance
        assert "AAPL" in system_content  # position ticker
