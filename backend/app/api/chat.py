"""Chat API endpoint — LLM interaction with auto-execution."""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import (
    get_profile,
    get_positions,
    get_watchlist,
    get_chat_history,
    save_chat_message,
    get_position,
    update_position,
    remove_position,
    deduct_cash,
    add_cash,
    record_trade,
    add_snapshot,
    add_to_watchlist,
    remove_from_watchlist,
)
from app.llm import chat_completion
from app.market import PriceCache
from app.market.interface import MarketDataSource
from .dependencies import get_price_cache, get_market_source

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


def _build_portfolio_context(price_cache: PriceCache) -> dict:
    """Build portfolio context dict for the LLM."""
    profile = get_profile()
    positions = get_positions()
    watchlist = get_watchlist()
    cash = profile["cash_balance"]

    enriched_positions = []
    total_market_value = 0.0
    total_cost = 0.0

    for pos in positions:
        ticker = pos["ticker"]
        qty = pos["quantity"]
        avg = pos["avg_cost"]
        price = price_cache.get_price(ticker) or avg
        price = round(price, 2)
        mv = round(qty * price, 2)
        cost = round(qty * avg, 2)
        pnl = round(mv - cost, 2)
        total_market_value += mv
        total_cost += cost
        enriched_positions.append(
            {
                "ticker": ticker,
                "quantity": qty,
                "avg_cost": round(avg, 2),
                "current_price": price,
                "unrealized_pnl": pnl,
            }
        )

    total_value = round(cash + total_market_value, 2)
    unrealized_pnl = round(total_market_value - total_cost, 2)

    return {
        "cash_balance": round(cash, 2),
        "total_value": total_value,
        "unrealized_pnl": unrealized_pnl,
        "positions": enriched_positions,
        "watchlist": [item["ticker"] for item in watchlist],
    }


def _execute_trade(ticker: str, side: str, quantity: float, price_cache: PriceCache) -> dict | None:
    """Execute a single trade. Returns result dict or raises on error."""
    price = price_cache.get_price(ticker)
    if price is None:
        raise ValueError(f"Unknown ticker: {ticker}")

    price = round(price, 2)
    total = round(price * quantity, 2)

    if side == "buy":
        profile = get_profile()
        cash = profile["cash_balance"]
        if cash < total:
            raise ValueError(f"Insufficient cash. Need ${total:.2f}, have ${cash:.2f}")
        deduct_cash(total)
        existing = get_position(ticker)
        if existing:
            old_qty = existing["quantity"]
            old_avg = existing["avg_cost"]
            new_qty = old_qty + quantity
            new_avg = (old_qty * old_avg + quantity * price) / new_qty
        else:
            new_qty = quantity
            new_avg = price
        update_position(ticker, new_qty, new_avg)
    else:  # sell
        existing = get_position(ticker)
        if not existing or existing["quantity"] < quantity:
            have = existing["quantity"] if existing else 0.0
            raise ValueError(f"Insufficient shares. Have {have}, selling {quantity}")
        add_cash(total)
        new_qty = round(existing["quantity"] - quantity, 10)
        if new_qty == 0:
            remove_position(ticker)
        else:
            update_position(ticker, new_qty, existing["avg_cost"])

    record_trade(ticker, side, quantity, price)
    return {"ticker": ticker, "side": side, "quantity": quantity, "price": price}


@router.post("")
async def chat(
    body: ChatRequest,
    price_cache: Annotated[PriceCache, Depends(get_price_cache)],
    market_source: Annotated[MarketDataSource, Depends(get_market_source)],
) -> dict:
    # Build portfolio context
    portfolio_context = _build_portfolio_context(price_cache)

    # Load chat history (last 20 messages as role/content dicts)
    history_rows = get_chat_history(limit=20)
    chat_history = [{"role": row["role"], "content": row["content"]} for row in history_rows]

    # Save user message
    save_chat_message(role="user", content=body.message)

    # Call LLM
    try:
        llm_response = await chat_completion(body.message, portfolio_context, chat_history)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="LLM service unavailable") from exc

    # Auto-execute trades
    trades_executed = []
    errors = []

    for trade_action in llm_response.trades:
        ticker = trade_action.ticker.upper().strip()
        try:
            result = _execute_trade(ticker, trade_action.side, trade_action.quantity, price_cache)
            trades_executed.append(result)
        except (ValueError, Exception) as exc:
            errors.append(str(exc))

    # Snapshot after trades if any were executed
    if trades_executed:
        try:
            profile = get_profile()
            positions = get_positions()
            total = profile["cash_balance"]
            for pos in positions:
                p = price_cache.get_price(pos["ticker"])
                if p:
                    total += pos["quantity"] * p
            add_snapshot(round(total, 2))
        except Exception:
            pass

    # Auto-execute watchlist changes
    watchlist_changes_executed = []
    for wl_change in llm_response.watchlist_changes:
        ticker = wl_change.ticker.upper().strip()
        try:
            if wl_change.action == "add":
                add_to_watchlist(ticker)
                await market_source.add_ticker(ticker)
                watchlist_changes_executed.append({"ticker": ticker, "action": "add"})
            elif wl_change.action == "remove":
                remove_from_watchlist(ticker)
                await market_source.remove_ticker(ticker)
                watchlist_changes_executed.append({"ticker": ticker, "action": "remove"})
        except (ValueError, KeyError, Exception) as exc:
            errors.append(str(exc))

    # Build actions JSON for DB
    actions_data = {
        "trades_executed": trades_executed,
        "watchlist_changes": watchlist_changes_executed,
        "errors": errors,
    }

    # Save assistant message
    save_chat_message(
        role="assistant",
        content=llm_response.message,
        actions=json.dumps(actions_data),
    )

    return {
        "message": llm_response.message,
        "trades_executed": trades_executed,
        "watchlist_changes": watchlist_changes_executed,
        "errors": errors,
    }
