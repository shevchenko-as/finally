"""Watchlist API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_watchlist, add_to_watchlist, remove_from_watchlist
from app.market import PriceCache
from app.market.interface import MarketDataSource
from .dependencies import get_price_cache, get_market_source

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class AddTickerRequest(BaseModel):
    ticker: str


@router.get("")
async def list_watchlist(
    price_cache: Annotated[PriceCache, Depends(get_price_cache)],
) -> list[dict]:
    """Return all watchlist items enriched with current price and change percent."""
    items = get_watchlist()
    result = []
    for item in items:
        ticker = item["ticker"]
        update = price_cache.get(ticker)
        price = round(update.price, 2) if update else 0.0
        change_percent = round(update.change_percent, 2) if update else 0.0
        result.append(
            {
                "ticker": ticker,
                "added_at": item["added_at"],
                "price": price,
                "change_percent": change_percent,
            }
        )
    return result


@router.post("", status_code=201)
async def add_ticker(
    body: AddTickerRequest,
    market_source: Annotated[MarketDataSource, Depends(get_market_source)],
) -> dict:
    """Add a ticker to the watchlist."""
    ticker = body.ticker.upper().strip()
    try:
        row = add_to_watchlist(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Tell market source to start tracking this ticker
    await market_source.add_ticker(ticker)

    return {"ticker": row["ticker"], "added_at": row["added_at"]}


@router.delete("/{ticker}", status_code=204)
async def remove_ticker(
    ticker: str,
    market_source: Annotated[MarketDataSource, Depends(get_market_source)],
) -> None:
    """Remove a ticker from the watchlist."""
    ticker = ticker.upper().strip()
    try:
        remove_from_watchlist(ticker)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    await market_source.remove_ticker(ticker)
