"""Health check endpoint."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.market import PriceCache
from app.market.interface import MarketDataSource
from .dependencies import get_price_cache, get_market_source

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health(
    price_cache: Annotated[PriceCache, Depends(get_price_cache)],
    market_source: Annotated[MarketDataSource, Depends(get_market_source)],
) -> dict:
    # Determine which market data source is active
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    market_type = "massive" if api_key else "simulator"

    return {
        "status": "ok",
        "db": "ok",
        "market": market_type,
    }
