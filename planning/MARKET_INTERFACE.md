# Market Data Interface Design

Unified Python interface for market data in FinAlly. Two implementations — the Massive REST API and a GBM simulator — sit behind one abstract interface. All downstream code (SSE streaming, portfolio valuation, trade execution) is source-agnostic.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│              App startup                     │
│  create_market_data_source(price_cache)      │
│         ↓                    ↓               │
│  MassiveDataSource   SimulatorDataSource     │
│  (MASSIVE_API_KEY    (no API key set)        │
│   is set)                                    │
└─────────────┬───────────────┬───────────────┘
              │               │
              ▼               ▼
         ┌──────────────────────┐
         │      PriceCache       │  ← single shared store
         │  {ticker: PriceUpdate}│
         └──────────┬───────────┘
                    │
         ┌──────────▼───────────┐
         │   SSE /stream        │  reads every 500ms
         │   Trade execution    │  reads on demand
         │   Portfolio value    │  reads on demand
         └──────────────────────┘
```

Both data sources **push** into `PriceCache` on their own schedule. Downstream code never calls the data source directly — it only reads from the cache.

---

## Core Data Model

Defined in `backend/app/market/models.py`.

```python
from __future__ import annotations
import time
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class PriceUpdate:
    """Immutable snapshot of a single ticker's price at one point in time."""

    ticker: str
    price: float
    previous_price: float
    timestamp: float = field(default_factory=time.time)  # Unix seconds

    @property
    def change(self) -> float:
        """Absolute price change from the previous update."""
        return round(self.price - self.previous_price, 4)

    @property
    def change_percent(self) -> float:
        """Percentage change from the previous update."""
        if self.previous_price == 0:
            return 0.0
        return round((self.price - self.previous_price) / self.previous_price * 100, 4)

    @property
    def direction(self) -> str:
        """'up', 'down', or 'flat'."""
        if self.price > self.previous_price:
            return "up"
        elif self.price < self.previous_price:
            return "down"
        return "flat"

    def to_dict(self) -> dict:
        """Serialize for JSON / SSE transmission."""
        return {
            "ticker": self.ticker,
            "price": self.price,
            "previous_price": self.previous_price,
            "timestamp": self.timestamp,
            "change": self.change,
            "change_percent": self.change_percent,
            "direction": self.direction,
        }
```

`PriceUpdate` is frozen and uses `__slots__` — safe to share across threads without copying.

---

## Abstract Interface

Defined in `backend/app/market/interface.py`.

```python
from abc import ABC, abstractmethod


class MarketDataSource(ABC):
    """Contract for market data providers.

    Both implementations (Massive API and GBM Simulator) satisfy this interface.
    Downstream code depends only on this class, never on the concrete implementations.

    Lifecycle:
        source = create_market_data_source(cache)
        await source.start(["AAPL", "GOOGL", ...])
        # ... app runs ...
        await source.add_ticker("TSLA")
        await source.remove_ticker("GOOGL")
        # ... shutting down ...
        await source.stop()
    """

    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        """Begin producing price updates for the given tickers.

        Starts a background asyncio task that periodically writes to PriceCache.
        Must be called exactly once. Calling start() twice is undefined behavior.
        """

    @abstractmethod
    async def stop(self) -> None:
        """Stop the background task and release resources.

        Safe to call multiple times. After stop(), the source will not write
        to the cache again.
        """

    @abstractmethod
    async def add_ticker(self, ticker: str) -> None:
        """Add a ticker to the active set. No-op if already present."""

    @abstractmethod
    async def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker from the active set. Also removes it from PriceCache."""

    @abstractmethod
    def get_tickers(self) -> list[str]:
        """Return the current list of actively tracked tickers."""
```

---

## Price Cache

Defined in `backend/app/market/cache.py`.

The shared in-memory store that data sources write to and everything else reads from. Thread-safe — the background data source task and the SSE async task access it concurrently.

```python
import time
from threading import Lock
from .models import PriceUpdate


class PriceCache:
    """Thread-safe in-memory cache of the latest price per ticker."""

    def __init__(self) -> None:
        self._prices: dict[str, PriceUpdate] = {}
        self._lock = Lock()
        self._version: int = 0  # Bumped on every update; useful for change detection

    def update(self, ticker: str, price: float, timestamp: float | None = None) -> PriceUpdate:
        """Record a new price. Computes direction/change from the previous entry.

        First update for a ticker: previous_price == price, direction == 'flat'.
        """
        with self._lock:
            ts = timestamp or time.time()
            prev = self._prices.get(ticker)
            previous_price = prev.price if prev else price
            update = PriceUpdate(
                ticker=ticker,
                price=round(price, 2),
                previous_price=round(previous_price, 2),
                timestamp=ts,
            )
            self._prices[ticker] = update
            self._version += 1
            return update

    def get(self, ticker: str) -> PriceUpdate | None:
        with self._lock:
            return self._prices.get(ticker)

    def get_all(self) -> dict[str, PriceUpdate]:
        """Snapshot of all current prices. Returns a shallow copy."""
        with self._lock:
            return dict(self._prices)

    def get_price(self, ticker: str) -> float | None:
        update = self.get(ticker)
        return update.price if update else None

    def remove(self, ticker: str) -> None:
        with self._lock:
            self._prices.pop(ticker, None)

    @property
    def version(self) -> int:
        """Monotonically increasing counter. Bumped on every update."""
        return self._version
```

---

## Factory Function

Defined in `backend/app/market/factory.py`.

Selects the data source at startup based on the `MASSIVE_API_KEY` environment variable.

```python
import logging
import os
from .cache import PriceCache
from .interface import MarketDataSource


def create_market_data_source(price_cache: PriceCache) -> MarketDataSource:
    """Return the appropriate MarketDataSource for the current environment.

    - MASSIVE_API_KEY present and non-empty → MassiveDataSource (real data)
    - Otherwise                             → SimulatorDataSource (GBM simulation)

    Returns an *unstarted* source. Caller must await source.start(tickers).
    """
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()

    if api_key:
        from .massive_client import MassiveDataSource
        logging.getLogger(__name__).info("Market data: Massive API (real data)")
        return MassiveDataSource(api_key=api_key, price_cache=price_cache)
    else:
        from .simulator import SimulatorDataSource
        logging.getLogger(__name__).info("Market data: GBM Simulator")
        return SimulatorDataSource(price_cache=price_cache)
```

---

## Massive Implementation

Defined in `backend/app/market/massive_client.py`.

Polls `GET /v2/snapshot/locale/us/markets/stocks/tickers` on a timer. One API call per cycle covers all tickers.

```python
import asyncio
import logging
from massive import RESTClient
from massive.rest.models import SnapshotMarketType
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)


class MassiveDataSource(MarketDataSource):
    """MarketDataSource backed by the Massive REST API.

    poll_interval defaults to 15s (safe for the free tier: 5 req/min).
    Set lower (2–5s) on paid tiers.
    """

    def __init__(self, api_key: str, price_cache: PriceCache, poll_interval: float = 15.0):
        self._api_key = api_key
        self._cache = price_cache
        self._interval = poll_interval
        self._tickers: list[str] = []
        self._task: asyncio.Task | None = None
        self._client: RESTClient | None = None

    async def start(self, tickers: list[str]) -> None:
        self._client = RESTClient(api_key=self._api_key)
        self._tickers = list(tickers)
        await self._poll_once()  # Immediate first poll — cache has data right away
        self._task = asyncio.create_task(self._poll_loop(), name="massive-poller")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._client = None

    async def add_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        if ticker not in self._tickers:
            self._tickers.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        self._tickers = [t for t in self._tickers if t != ticker]
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._poll_once()

    async def _poll_once(self) -> None:
        if not self._tickers or not self._client:
            return
        try:
            snapshots = await asyncio.to_thread(
                self._client.get_snapshot_all,
                market_type=SnapshotMarketType.STOCKS,
                tickers=self._tickers,
            )
            for snap in snapshots:
                self._cache.update(
                    ticker=snap.ticker,
                    price=snap.last_trade.price,
                    timestamp=snap.last_trade.timestamp / 1000.0,  # ms → seconds
                )
        except Exception as e:
            logger.error("Massive poll failed: %s", e)
            # Don't re-raise — the loop retries on the next interval.
```

---

## Simulator Implementation

Defined in `backend/app/market/simulator.py`. See `MARKET_SIMULATOR.md` for the full GBM math and correlation design.

```python
import asyncio
from .cache import PriceCache
from .interface import MarketDataSource
from .simulator import GBMSimulator  # see MARKET_SIMULATOR.md


class SimulatorDataSource(MarketDataSource):
    """MarketDataSource backed by the GBM simulator.

    Calls GBMSimulator.step() every update_interval seconds and writes
    results to the PriceCache. Default interval is 500ms.
    """

    def __init__(self, price_cache: PriceCache, update_interval: float = 0.5):
        self._cache = price_cache
        self._interval = update_interval
        self._sim: GBMSimulator | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._sim = GBMSimulator(tickers=tickers)
        # Seed cache with initial prices so SSE has data before the first step
        for ticker in tickers:
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)
        self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def add_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.add_ticker(ticker)
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)

    async def remove_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.remove_ticker(ticker)
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return self._sim.get_tickers() if self._sim else []

    async def _run_loop(self) -> None:
        while True:
            try:
                if self._sim:
                    for ticker, price in self._sim.step().items():
                        self._cache.update(ticker=ticker, price=price)
            except Exception:
                pass  # Never let a step failure kill the loop
            await asyncio.sleep(self._interval)
```

---

## Integration with SSE Streaming

The SSE endpoint reads from `PriceCache` and pushes to connected clients. It never interacts with the data source directly.

```python
import asyncio
import json
from .cache import PriceCache


async def price_stream(price_cache: PriceCache):
    """AsyncGenerator for Server-Sent Events. Yields all prices every 500ms."""
    while True:
        data = {
            ticker: update.to_dict()
            for ticker, update in price_cache.get_all().items()
        }
        yield f"data: {json.dumps(data)}\n\n"
        await asyncio.sleep(0.5)
```

---

## File Structure

```
backend/
  app/
    market/
      __init__.py          # Re-exports: PriceUpdate, PriceCache, MarketDataSource, create_market_data_source
      models.py            # PriceUpdate dataclass
      cache.py             # PriceCache
      interface.py         # MarketDataSource ABC
      factory.py           # create_market_data_source()
      massive_client.py    # MassiveDataSource
      simulator.py         # SimulatorDataSource + GBMSimulator
      seed_prices.py       # SEED_PRICES, TICKER_PARAMS, CORRELATION_GROUPS constants
```

---

## App Lifecycle

| Stage | Action |
|-------|--------|
| Startup | `cache = PriceCache()` → `source = create_market_data_source(cache)` → `await source.start(initial_tickers)` |
| Watchlist add | `await source.add_ticker("TSLA")` |
| Watchlist remove | `await source.remove_ticker("GOOGL")` |
| SSE streaming | `price_cache.get_all()` every 500ms |
| Trade execution | `price_cache.get_price("AAPL")` on demand |
| Shutdown | `await source.stop()` |

---

## Key Design Decisions

**Push model, not pull.** The data source writes to a shared cache on its own schedule rather than being called on demand. This decouples the polling/simulation rate from the SSE delivery rate and from trade execution.

**Single source of truth.** `PriceCache` is the only place prices live. There's no risk of the SSE stream and the trading engine seeing different prices.

**Transparent switching.** `create_market_data_source()` is the only place that knows which implementation is active. All other code depends only on `MarketDataSource` and `PriceCache`.

**Async-safe synchronous client.** The Massive `RESTClient` is synchronous. `asyncio.to_thread()` runs it in a thread pool so it doesn't block the FastAPI event loop.
