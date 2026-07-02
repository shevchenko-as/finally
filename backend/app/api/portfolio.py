"""Portfolio API endpoints."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import (
    get_profile,
    get_positions,
    get_position,
    update_position,
    remove_position,
    deduct_cash,
    add_cash,
    record_trade,
    add_snapshot,
    get_snapshots,
)
from app.market import PriceCache
from .dependencies import get_price_cache

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


class TradeRequest(BaseModel):
    ticker: str
    side: str  # "buy" | "sell"
    quantity: float


def _build_portfolio_response(price_cache: PriceCache) -> dict:
    """Compute and return the full portfolio response dict."""
    profile = get_profile()
    positions = get_positions()
    cash = round(profile["cash_balance"], 2)

    enriched = []
    total_market_value = 0.0
    total_cost = 0.0

    for pos in positions:
        ticker = pos["ticker"]
        qty = pos["quantity"]
        avg = pos["avg_cost"]
        price = price_cache.get_price(ticker) or avg  # fall back to avg if no price yet
        price = round(price, 2)
        market_value = round(qty * price, 2)
        cost_basis = round(qty * avg, 2)
        unrealized_pnl = round(market_value - cost_basis, 2)
        unrealized_pnl_percent = round((unrealized_pnl / cost_basis * 100) if cost_basis else 0.0, 2)
        total_market_value += market_value
        total_cost += cost_basis
        enriched.append(
            {
                "ticker": ticker,
                "quantity": qty,
                "avg_cost": round(avg, 2),
                "current_price": price,
                "market_value": market_value,
                "unrealized_pnl": unrealized_pnl,
                "unrealized_pnl_percent": unrealized_pnl_percent,
                "weight": 0.0,  # computed after we know total_value
            }
        )

    total_value = round(cash + total_market_value, 2)
    total_cost = round(total_cost, 2)
    portfolio_unrealized_pnl = round(total_market_value - total_cost, 2)
    portfolio_unrealized_pnl_percent = round(
        (portfolio_unrealized_pnl / total_cost * 100) if total_cost else 0.0, 2
    )

    # Fill in weight (% of total portfolio value)
    for pos in enriched:
        pos["weight"] = round((pos["market_value"] / total_value * 100) if total_value else 0.0, 2)

    return {
        "cash_balance": cash,
        "total_value": total_value,
        "total_cost": total_cost,
        "unrealized_pnl": portfolio_unrealized_pnl,
        "unrealized_pnl_percent": portfolio_unrealized_pnl_percent,
        "positions": enriched,
    }


def _record_snapshot(price_cache: PriceCache) -> None:
    """Take an immediate portfolio value snapshot."""
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


@router.get("")
async def get_portfolio(
    price_cache: Annotated[PriceCache, Depends(get_price_cache)],
) -> dict:
    return _build_portfolio_response(price_cache)


@router.post("/trade")
async def trade(
    body: TradeRequest,
    price_cache: Annotated[PriceCache, Depends(get_price_cache)],
) -> dict:
    ticker = body.ticker.upper().strip()
    side = body.side.lower()
    quantity = body.quantity

    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be 'buy' or 'sell'")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be positive")

    price = price_cache.get_price(ticker)
    if price is None:
        raise HTTPException(status_code=400, detail=f"Unknown ticker: {ticker}. Add it to watchlist first.")

    price = round(price, 2)
    total = round(price * quantity, 2)

    if side == "buy":
        profile = get_profile()
        cash = profile["cash_balance"]
        if cash < total:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash. Need ${total:.2f}, have ${cash:.2f}",
            )
        new_balance = deduct_cash(total)

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
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient shares. Have {have}, selling {quantity}",
            )

        new_balance = add_cash(total)
        new_qty = round(existing["quantity"] - quantity, 10)
        if new_qty == 0:
            remove_position(ticker)
        else:
            update_position(ticker, new_qty, existing["avg_cost"])

    trade_row = record_trade(ticker, side, quantity, price)
    _record_snapshot(price_cache)

    return {
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": price,
        "total": total,
        "cash_balance": round(new_balance, 2),
        "executed_at": trade_row["executed_at"],
    }


@router.get("/history")
async def portfolio_history() -> list[dict]:
    """Return portfolio value snapshots for the P&L chart."""
    snapshots = get_snapshots()
    return [{"total_value": round(s["total_value"], 2), "recorded_at": s["recorded_at"]} for s in snapshots]
