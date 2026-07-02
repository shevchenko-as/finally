"""Shared fixtures for API tests."""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.market import PriceCache
from app.market.interface import MarketDataSource


@pytest.fixture(autouse=True)
def tmp_db(tmp_path):
    """Set DB_PATH to a temp file and reset after the test."""
    db_file = tmp_path / "test.db"
    os.environ["DB_PATH"] = str(db_file)
    from app.db import init_db
    init_db()
    yield str(db_file)
    os.environ.pop("DB_PATH", None)


@pytest.fixture
def price_cache():
    cache = PriceCache()
    # Pre-populate with some prices
    cache.update("AAPL", 190.50)
    cache.update("NVDA", 800.00)
    cache.update("TSLA", 250.00)
    return cache


@pytest.fixture
def mock_market_source():
    source = MagicMock(spec=MarketDataSource)
    source.add_ticker = AsyncMock()
    source.remove_ticker = AsyncMock()
    source.start = AsyncMock()
    source.stop = AsyncMock()
    return source


@pytest.fixture
def client(price_cache, mock_market_source):
    """TestClient with DB initialized and market state injected.

    We patch the lifespan to prevent it from starting real market tasks,
    then inject our test doubles into app.state.
    """
    from unittest.mock import patch, AsyncMock
    from contextlib import asynccontextmanager
    from app.main import app

    @asynccontextmanager
    async def mock_lifespan(app):
        # Inject test doubles into app.state before yielding
        app.state.price_cache = price_cache
        app.state.market_source = mock_market_source
        yield

    with patch.object(app, "router") as _:
        pass  # no-op, just to get inside context

    # Patch the lifespan on the app
    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = mock_lifespan

    try:
        with TestClient(app, raise_server_exceptions=True) as c:
            yield c
    finally:
        app.router.lifespan_context = original_lifespan
