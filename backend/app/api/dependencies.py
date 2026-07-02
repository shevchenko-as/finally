"""FastAPI dependency injection helpers."""

from fastapi import Request

from app.market import PriceCache
from app.market.interface import MarketDataSource


def get_price_cache(request: Request) -> PriceCache:
    return request.app.state.price_cache


def get_market_source(request: Request) -> MarketDataSource:
    return request.app.state.market_source
