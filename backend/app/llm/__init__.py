"""LLM integration module for FinAlly.

Public interface:
    chat_completion(user_message, portfolio_context, chat_history) -> LLMResponse
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import litellm

from .prompt import build_system_prompt

__all__ = [
    "TradeAction",
    "WatchlistChange",
    "LLMResponse",
    "chat_completion",
]

_MODEL = "groq/llama-3.3-70b-versatile"
_MOCK_RESPONSE = "[MOCK] I'm the FinAlly AI assistant. How can I help?"


@dataclass
class TradeAction:
    ticker: str
    side: str  # "buy" | "sell"
    quantity: float


@dataclass
class WatchlistChange:
    ticker: str
    action: str  # "add" | "remove"


@dataclass
class LLMResponse:
    message: str
    trades: list[TradeAction] = field(default_factory=list)
    watchlist_changes: list[WatchlistChange] = field(default_factory=list)


def _parse_llm_json(raw: str) -> LLMResponse:
    """Parse the JSON string returned by the model into an LLMResponse.

    Returns an error LLMResponse if the JSON is malformed or missing required fields.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return LLMResponse(message=f"[Error] Could not parse LLM response: {exc}")

    message = data.get("message")
    if not isinstance(message, str) or not message:
        return LLMResponse(message="[Error] LLM returned a response without a message field.")

    trades: list[TradeAction] = []
    for item in data.get("trades", []):
        try:
            trades.append(
                TradeAction(
                    ticker=str(item["ticker"]),
                    side=str(item["side"]),
                    quantity=float(item["quantity"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            # Skip malformed trade entries silently
            pass

    watchlist_changes: list[WatchlistChange] = []
    for item in data.get("watchlist_changes", []):
        try:
            watchlist_changes.append(
                WatchlistChange(
                    ticker=str(item["ticker"]),
                    action=str(item["action"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            pass

    return LLMResponse(
        message=message,
        trades=trades,
        watchlist_changes=watchlist_changes,
    )


async def chat_completion(
    user_message: str,
    portfolio_context: dict,
    chat_history: list[dict],
) -> LLMResponse:
    """Call the LLM and return a structured LLMResponse.

    Args:
        user_message: The latest message from the user.
        portfolio_context: Current portfolio state (cash, positions, watchlist, P&L).
        chat_history: Prior conversation turns as list of {"role": ..., "content": ...}.

    Returns:
        LLMResponse with message, optional trades, and optional watchlist changes.
    """
    # Mock mode: skip the API call entirely
    if os.environ.get("LLM_MOCK", "").lower() == "true":
        return LLMResponse(
            message=_MOCK_RESPONSE,
            trades=[],
            watchlist_changes=[],
        )

    system_prompt = build_system_prompt(portfolio_context)

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(chat_history)
    messages.append({"role": "user", "content": user_message})

    response = await litellm.acompletion(
        model=_MODEL,
        messages=messages,
        response_format={"type": "json_object"},
        api_key=os.environ["GROQ_API_KEY"],
    )

    raw_content: str = response.choices[0].message.content or ""
    return _parse_llm_json(raw_content)
