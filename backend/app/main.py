"""FinAlly FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.db import init_db, get_watchlist, add_snapshot, get_positions, get_profile
from app.market import PriceCache, create_market_data_source
from app.market.stream import _generate_events

logger = logging.getLogger(__name__)


async def _snapshot_loop(price_cache: PriceCache) -> None:
    """Record portfolio value snapshot every 30 seconds."""
    while True:
        await asyncio.sleep(30)
        try:
            positions = get_positions()
            profile = get_profile()
            total_value = profile["cash_balance"]
            for pos in positions:
                price = price_cache.get_price(pos["ticker"])
                if price:
                    total_value += pos["quantity"] * price
            add_snapshot(round(total_value, 2))
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Initialize database (idempotent)
    init_db()

    # 2. Start market data source
    app.state.price_cache = PriceCache()
    app.state.market_source = create_market_data_source(app.state.price_cache)

    # Load initial tickers from watchlist
    watchlist = get_watchlist()
    tickers = [item["ticker"] for item in watchlist]
    await app.state.market_source.start(tickers)

    # 3. Start portfolio snapshot background task (every 30s)
    app.state.snapshot_task = asyncio.create_task(_snapshot_loop(app.state.price_cache))

    yield

    # Shutdown
    await app.state.market_source.stop()
    app.state.snapshot_task.cancel()
    try:
        await app.state.snapshot_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="FinAlly", lifespan=lifespan)

# Include API routers
from app.api import health, portfolio, watchlist, chat  # noqa: E402

app.include_router(health.router)
app.include_router(portfolio.router)
app.include_router(watchlist.router)
app.include_router(chat.router)


# SSE streaming endpoint — reads price_cache from app.state at request time
@app.get("/api/stream/prices", tags=["streaming"])
async def stream_prices(request: Request) -> StreamingResponse:
    """SSE endpoint for live price updates."""
    price_cache: PriceCache = request.app.state.price_cache
    return StreamingResponse(
        _generate_events(price_cache, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# Serve static frontend files (built Next.js export)
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
