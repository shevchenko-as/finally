# Market Data Backend — Implementation Design

End-to-end design for FinAlly's market data subsystem. Covers the full stack from raw price ingestion to SSE delivery, with complete code examples for every layer.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          App startup                                 │
│                                                                      │
│  MASSIVE_API_KEY set?                                                │
│       YES ──► MassiveDataSource    NO ──► SimulatorDataSource        │
│                    │                            │                    │
│                    │  poll every 15s            │  step every 500ms  │
│                    ▼                            ▼                    │
│              ┌──────────────────────────────────────┐               │
│              │              PriceCache               │               │
│              │   { "AAPL": PriceUpdate, ... }        │               │
│              └──────────────────────────────────────┘               │
│                    │                            │                    │
│              SSE /api/stream/prices    GET /api/prices/{ticker}      │
│              (push every 500ms)        (pull on demand)              │
└─────────────────────────────────────────────────────────────────────┘
```

There is exactly one `PriceCache` per running server instance. Both data sources write to it; all read paths (SSE, REST, trade execution) read from it. No component reads from a data source directly.

---

## Module Structure

```
backend/
  app/
    market/
      __init__.py          # Public API: re-exports 5 names
      models.py            # PriceUpdate dataclass
      cache.py             # PriceCache
      interface.py         # MarketDataSource ABC
      factory.py           # create_market_data_source()
      massive_client.py    # MassiveDataSource
      simulator.py         # GBMSimulator + SimulatorDataSource
      seed_prices.py       # Constants: prices, GBM params, correlations
      stream.py            # FastAPI SSE router
  market_data_demo.py      # Standalone terminal demo (Rich)
```

Anything outside this package imports only from `app.market` — never from sub-modules directly.

```python
# Correct
from app.market import PriceCache, create_market_data_source

# Wrong — leaks internal structure
from app.market.cache import PriceCache
```

---

## Layer 1 — Data Model (`models.py`)

`PriceUpdate` is the single data structure that leaves the market data layer. It is immutable (`frozen=True`), memory-efficient (`slots=True`), and safe to share across threads without copying.

```python
from __future__ import annotations
import time
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class PriceUpdate:
    ticker: str
    price: float
    previous_price: float
    timestamp: float = field(default_factory=time.time)  # Unix seconds

    @property
    def change(self) -> float:
        return round(self.price - self.previous_price, 4)

    @property
    def change_percent(self) -> float:
        if self.previous_price == 0:
            return 0.0
        return round((self.price - self.previous_price) / self.previous_price * 100, 4)

    @property
    def direction(self) -> str:
        if self.price > self.previous_price:
            return "up"
        elif self.price < self.previous_price:
            return "down"
        return "flat"

    def to_dict(self) -> dict:
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

**Usage example:**

```python
from app.market import PriceCache

cache = PriceCache()
cache.update("AAPL", 190.00)
update = cache.update("AAPL", 191.50)

print(update.price)          # 191.5
print(update.change)         # 1.5
print(update.change_percent) # 0.7895
print(update.direction)      # "up"
print(update.to_dict())
# {
#   "ticker": "AAPL",
#   "price": 191.5,
#   "previous_price": 190.0,
#   "timestamp": 1706745600.123,
#   "change": 1.5,
#   "change_percent": 0.7895,
#   "direction": "up"
# }
```

---

## Layer 2 — Price Cache (`cache.py`)

The shared in-memory store. One writer (the active data source), multiple concurrent readers (SSE, REST, trade engine). Uses a `threading.Lock` because the asyncio background task and any synchronous FastAPI dependencies may access it at the same time.

```python
import time
from threading import Lock
from .models import PriceUpdate


class PriceCache:
    def __init__(self) -> None:
        self._prices: dict[str, PriceUpdate] = {}
        self._lock = Lock()
        self._version: int = 0

    def update(self, ticker: str, price: float, timestamp: float | None = None) -> PriceUpdate:
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
        with self._lock:
            return dict(self._prices)          # shallow copy — safe for caller

    def get_price(self, ticker: str) -> float | None:
        update = self.get(ticker)
        return update.price if update else None

    def remove(self, ticker: str) -> None:
        with self._lock:
            self._prices.pop(ticker, None)

    @property
    def version(self) -> int:
        return self._version                   # no lock needed (int reads are atomic in CPython)
```

**`version` is the key to efficient SSE.** The SSE generator compares `cache.version` to `last_version` before serialising JSON. If nothing changed, it skips the serialisation entirely — no CPU work at 2 Hz with a static watchlist.

**Cache lifecycle example:**

```python
cache = PriceCache()

# Write (from data source background task)
cache.update("AAPL", 190.00)
cache.update("AAPL", 190.50)   # direction = "up"

# Read (from SSE or REST handler)
update = cache.get("AAPL")     # PriceUpdate(ticker='AAPL', price=190.5, ...)
price  = cache.get_price("AAPL")  # 190.5
all_   = cache.get_all()          # {"AAPL": PriceUpdate(...)}

# Watchlist removal
cache.remove("AAPL")
cache.get("AAPL")              # None
```

---

## Layer 3 — Abstract Interface (`interface.py`)

`MarketDataSource` is the contract both implementations must satisfy. All app code that needs to control the data source (start, stop, add/remove tickers) depends only on this ABC — never on a concrete class.

```python
from abc import ABC, abstractmethod


class MarketDataSource(ABC):
    """
    Lifecycle:
        source = create_market_data_source(cache)
        await source.start(["AAPL", "GOOGL"])   # once
        await source.add_ticker("TSLA")
        await source.remove_ticker("GOOGL")
        await source.stop()                      # once, on shutdown
    """

    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        """Start the background task. Call exactly once."""

    @abstractmethod
    async def stop(self) -> None:
        """Stop the background task. Safe to call multiple times."""

    @abstractmethod
    async def add_ticker(self, ticker: str) -> None:
        """Add a ticker. No-op if already present."""

    @abstractmethod
    async def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker. Also removes it from PriceCache."""

    @abstractmethod
    def get_tickers(self) -> list[str]:
        """Return the current list of tracked tickers."""
```

---

## Layer 4 — Factory (`factory.py`)

The single place where the choice between real data and simulation is made.

```python
import logging
import os
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)


def create_market_data_source(price_cache: PriceCache) -> MarketDataSource:
    """
    Decision logic:
      MASSIVE_API_KEY set and non-empty → MassiveDataSource  (real market data)
      otherwise                         → SimulatorDataSource (GBM simulation)

    Returns an *unstarted* source. Caller must:
        await source.start(initial_tickers)
    """
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()

    if api_key:
        from .massive_client import MassiveDataSource
        logger.info("Market data source: Massive API")
        return MassiveDataSource(api_key=api_key, price_cache=price_cache)

    from .simulator import SimulatorDataSource
    logger.info("Market data source: GBM Simulator")
    return SimulatorDataSource(price_cache=price_cache)
```

**Switching between modes:**

```bash
# Simulator (default — no env var needed)
uv run uvicorn app.main:app

# Real data
MASSIVE_API_KEY=your_key_here uv run uvicorn app.main:app

# Paid tier with faster polling (2s)
MASSIVE_API_KEY=your_key MASSIVE_POLL_INTERVAL=2 uv run uvicorn app.main:app
```

---

## Layer 5a — Simulator (`simulator.py`)

### GBM Mathematics

At each 500ms tick, every price evolves as:

```
S(t+dt) = S(t) × exp( (μ − σ²/2)×dt  +  σ×√dt×Z )
```

| Symbol | Meaning | Example |
|--------|---------|---------|
| `μ` | Annualised drift | 0.05 (5%) |
| `σ` | Annualised volatility | 0.22 (AAPL) to 0.50 (TSLA) |
| `dt` | 500ms as fraction of a trading year | ~8.48×10⁻⁸ |
| `Z` | Correlated standard normal | drawn each step |

`dt` is computed once at class level:

```python
TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600   # 5,896,800
DEFAULT_DT = 0.5 / TRADING_SECONDS_PER_YEAR    # 8.48e-8
```

### Correlated Random Draws

Tech stocks move together; finance stocks move together. We replicate this with **Cholesky decomposition**. Given correlation matrix `C`:

```
L = cholesky(C)          # pre-computed, rebuilt when tickers change
Z_corr = L @ Z_ind       # Z_ind is n independent N(0,1) draws
```

Correlation rules (defined in `seed_prices.py`):

| Pair | ρ |
|------|---|
| Tech × Tech (AAPL, GOOGL, MSFT, AMZN, META, NVDA, NFLX) | 0.6 |
| Finance × Finance (JPM, V) | 0.5 |
| TSLA × anything | 0.3 |
| Cross-sector / unknown | 0.3 |

### `GBMSimulator` — complete implementation

```python
import math, random, logging
import numpy as np
from .seed_prices import (
    SEED_PRICES, TICKER_PARAMS, DEFAULT_PARAMS,
    CORRELATION_GROUPS,
    INTRA_TECH_CORR, INTRA_FINANCE_CORR, CROSS_GROUP_CORR, TSLA_CORR,
)

logger = logging.getLogger(__name__)


class GBMSimulator:
    TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600
    DEFAULT_DT = 0.5 / TRADING_SECONDS_PER_YEAR   # ~8.48e-8

    def __init__(self, tickers: list[str], dt: float = DEFAULT_DT,
                 event_probability: float = 0.001) -> None:
        self._dt = dt
        self._event_prob = event_probability
        self._tickers: list[str] = []
        self._prices: dict[str, float] = {}
        self._params: dict[str, dict[str, float]] = {}
        self._cholesky: np.ndarray | None = None

        for ticker in tickers:               # batch init — rebuild Cholesky once
            self._add_ticker_internal(ticker)
        self._rebuild_cholesky()

    # ── Hot path ────────────────────────────────────────────────────────────

    def step(self) -> dict[str, float]:
        """Advance all tickers by one dt. Called every 500ms."""
        n = len(self._tickers)
        if n == 0:
            return {}

        z = self._cholesky @ np.random.standard_normal(n) \
            if self._cholesky is not None \
            else np.random.standard_normal(n)

        result: dict[str, float] = {}
        for i, ticker in enumerate(self._tickers):
            mu    = self._params[ticker]["mu"]
            sigma = self._params[ticker]["sigma"]

            drift     = (mu - 0.5 * sigma**2) * self._dt
            diffusion = sigma * math.sqrt(self._dt) * z[i]
            self._prices[ticker] *= math.exp(drift + diffusion)

            # Random shock — ~0.1% chance per tick
            if random.random() < self._event_prob:
                magnitude = random.uniform(0.02, 0.05)
                sign      = random.choice([-1, 1])
                self._prices[ticker] *= 1 + magnitude * sign
                logger.debug("Event on %s: %+.1f%%", ticker, magnitude * sign * 100)

            result[ticker] = round(self._prices[ticker], 2)

        return result

    # ── Ticker management ───────────────────────────────────────────────────

    def add_ticker(self, ticker: str) -> None:
        if ticker in self._prices:
            return
        self._add_ticker_internal(ticker)
        self._rebuild_cholesky()           # O(n²), negligible for n < 50

    def remove_ticker(self, ticker: str) -> None:
        if ticker not in self._prices:
            return
        self._tickers.remove(ticker)
        del self._prices[ticker]
        del self._params[ticker]
        self._rebuild_cholesky()

    def get_price(self, ticker: str) -> float | None:
        return self._prices.get(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)

    # ── Internals ───────────────────────────────────────────────────────────

    def _add_ticker_internal(self, ticker: str) -> None:
        self._tickers.append(ticker)
        self._prices[ticker] = SEED_PRICES.get(ticker, random.uniform(50.0, 300.0))
        self._params[ticker] = dict(TICKER_PARAMS.get(ticker, DEFAULT_PARAMS))

    def _rebuild_cholesky(self) -> None:
        n = len(self._tickers)
        if n <= 1:
            self._cholesky = None
            return
        corr = np.eye(n)
        for i in range(n):
            for j in range(i + 1, n):
                rho = self._pairwise_correlation(self._tickers[i], self._tickers[j])
                corr[i, j] = corr[j, i] = rho
        self._cholesky = np.linalg.cholesky(corr)

    @staticmethod
    def _pairwise_correlation(t1: str, t2: str) -> float:
        if t1 == "TSLA" or t2 == "TSLA":
            return TSLA_CORR
        tech    = CORRELATION_GROUPS["tech"]
        finance = CORRELATION_GROUPS["finance"]
        if t1 in tech    and t2 in tech:    return INTRA_TECH_CORR
        if t1 in finance and t2 in finance: return INTRA_FINANCE_CORR
        return CROSS_GROUP_CORR
```

### `SimulatorDataSource` — async wrapper

```python
import asyncio, logging
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)


class SimulatorDataSource(MarketDataSource):
    def __init__(self, price_cache: PriceCache, update_interval: float = 0.5,
                 event_probability: float = 0.001) -> None:
        self._cache      = price_cache
        self._interval   = update_interval
        self._event_prob = event_probability
        self._sim: GBMSimulator | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._sim = GBMSimulator(tickers=tickers, event_probability=self._event_prob)
        # Seed cache immediately so SSE has data before the first step fires
        for ticker in tickers:
            if (price := self._sim.get_price(ticker)) is not None:
                self._cache.update(ticker=ticker, price=price)
        self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")
        logger.info("Simulator started — %d tickers", len(tickers))

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def add_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.add_ticker(ticker)
            if (price := self._sim.get_price(ticker)) is not None:
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
                logger.exception("Simulator step failed — continuing")
            await asyncio.sleep(self._interval)
```

### Seed data (`seed_prices.py`)

```python
SEED_PRICES: dict[str, float] = {
    "AAPL": 190.00, "GOOGL": 175.00, "MSFT": 420.00,
    "AMZN": 185.00, "TSLA":  250.00, "NVDA": 800.00,
    "META": 500.00, "JPM":   195.00, "V":    280.00, "NFLX": 600.00,
}

TICKER_PARAMS: dict[str, dict[str, float]] = {
    "AAPL":  {"sigma": 0.22, "mu": 0.05},
    "GOOGL": {"sigma": 0.25, "mu": 0.05},
    "MSFT":  {"sigma": 0.20, "mu": 0.05},
    "AMZN":  {"sigma": 0.28, "mu": 0.05},
    "TSLA":  {"sigma": 0.50, "mu": 0.03},   # very high vol
    "NVDA":  {"sigma": 0.40, "mu": 0.08},   # high vol + strong drift
    "META":  {"sigma": 0.30, "mu": 0.05},
    "JPM":   {"sigma": 0.18, "mu": 0.04},
    "V":     {"sigma": 0.17, "mu": 0.04},
    "NFLX":  {"sigma": 0.35, "mu": 0.05},
}

DEFAULT_PARAMS: dict[str, float] = {"sigma": 0.25, "mu": 0.05}

CORRELATION_GROUPS: dict[str, set[str]] = {
    "tech":    {"AAPL", "GOOGL", "MSFT", "AMZN", "META", "NVDA", "NFLX"},
    "finance": {"JPM", "V"},
}

INTRA_TECH_CORR    = 0.6
INTRA_FINANCE_CORR = 0.5
CROSS_GROUP_CORR   = 0.3
TSLA_CORR          = 0.3
```

---

## Layer 5b — Massive API Client (`massive_client.py`)

Polls `GET /v2/snapshot/locale/us/markets/stocks/tickers` on a timer. One API call covers every tracked ticker — critical for staying within the free tier limit (5 req/min).

The Massive `RESTClient` is synchronous. We run it inside `asyncio.to_thread()` to avoid blocking the FastAPI event loop.

```python
import asyncio, logging
from massive import RESTClient
from massive.rest.models import SnapshotMarketType
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)


class MassiveDataSource(MarketDataSource):
    """
    poll_interval:
      Free tier  → 15s  (5 req/min limit)
      Paid tiers → 2–5s
    """

    def __init__(self, api_key: str, price_cache: PriceCache,
                 poll_interval: float = 15.0) -> None:
        self._api_key  = api_key
        self._cache    = price_cache
        self._interval = poll_interval
        self._tickers: list[str] = []
        self._client: RESTClient | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._client  = RESTClient(api_key=self._api_key)
        self._tickers = list(tickers)
        await self._poll_once()           # immediate first poll — no empty cache
        self._task = asyncio.create_task(self._poll_loop(), name="massive-poller")
        logger.info("Massive poller started — %d tickers, %.1fs interval",
                    len(tickers), self._interval)

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
            logger.info("Massive: added %s (appears on next poll)", ticker)

    async def remove_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        self._tickers = [t for t in self._tickers if t != ticker]
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)

    # ── Internal ─────────────────────────────────────────────────────────────

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
            updated = 0
            for snap in snapshots:
                try:
                    self._cache.update(
                        ticker    = snap.ticker,
                        price     = snap.last_trade.price,
                        timestamp = snap.last_trade.timestamp / 1000.0,  # ms→s
                    )
                    updated += 1
                except (AttributeError, TypeError) as e:
                    logger.warning("Skipping snapshot for %s: %s",
                                   getattr(snap, "ticker", "?"), e)
            logger.debug("Polled Massive: %d/%d tickers updated", updated, len(self._tickers))

        except Exception as e:
            logger.error("Massive poll failed: %s", e)
            # Don't re-raise — loop retries on the next interval
```

**Error handling summary:**

| Error | Cause | Behaviour |
|-------|-------|-----------|
| 401 Unauthorized | Bad API key | Logged; loop keeps retrying (operator should fix key) |
| 429 Too Many Requests | Rate limit hit | Logged; loop retries at next interval |
| 5xx Server Error | Massive outage | Client retries 3× automatically; then logged and skipped |
| `AttributeError` on snapshot | Malformed response field | Single ticker skipped; rest continue |
| Network timeout | Connectivity | Logged; loop retries at next interval |

---

## Layer 6 — SSE Streaming (`stream.py`)

The SSE endpoint is a FastAPI `StreamingResponse` backed by an async generator. It reads from `PriceCache` every 500ms and serialises only when the cache has changed (version check).

```python
import asyncio, json, logging
from collections.abc import AsyncGenerator
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from .cache import PriceCache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stream", tags=["streaming"])


def create_stream_router(price_cache: PriceCache) -> APIRouter:
    """Factory: inject PriceCache without globals."""

    @router.get("/prices")
    async def stream_prices(request: Request) -> StreamingResponse:
        return StreamingResponse(
            _generate_events(price_cache, request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",   # disable nginx buffering
            },
        )

    return router


async def _generate_events(
    price_cache: PriceCache,
    request: Request,
    interval: float = 0.5,
) -> AsyncGenerator[str, None]:
    yield "retry: 1000\n\n"    # browser reconnects after 1s on drop

    last_version = -1
    client_ip = request.client.host if request.client else "?"
    logger.info("SSE client connected: %s", client_ip)

    try:
        while True:
            if await request.is_disconnected():
                break

            if price_cache.version != last_version:
                last_version = price_cache.version
                prices = price_cache.get_all()
                if prices:
                    data = {t: u.to_dict() for t, u in prices.items()}
                    yield f"data: {json.dumps(data)}\n\n"

            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
    finally:
        logger.info("SSE client disconnected: %s", client_ip)
```

**SSE event format** (what the browser's `EventSource` receives):

```
retry: 1000

data: {"AAPL": {"ticker": "AAPL", "price": 190.50, "previous_price": 190.00,
       "timestamp": 1706745600.123, "change": 0.5, "change_percent": 0.2632,
       "direction": "up"}, "GOOGL": {...}, ...}

data: {"AAPL": {...}, ...}
```

**Frontend connection:**

```javascript
const source = new EventSource("/api/stream/prices");

source.onmessage = (event) => {
    const prices = JSON.parse(event.data);
    for (const [ticker, update] of Object.entries(prices)) {
        updateTickerRow(ticker, update);  // your UI function
    }
};

source.onerror = () => {
    console.warn("SSE disconnected — browser will auto-reconnect in 1s");
};
```

---

## App Wiring (`app/main.py`)

How all the pieces connect at startup and shutdown:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.market import PriceCache, create_market_data_source, create_stream_router

DEFAULT_TICKERS = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA",
                   "NVDA", "META", "JPM", "V", "NFLX"]

price_cache: PriceCache | None = None
market_source = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global price_cache, market_source

    # Startup
    price_cache   = PriceCache()
    market_source = create_market_data_source(price_cache)
    await market_source.start(DEFAULT_TICKERS)

    yield

    # Shutdown
    if market_source:
        await market_source.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(create_stream_router(price_cache))
```

**Watchlist management endpoints** (example REST handlers):

```python
from fastapi import HTTPException

@app.post("/api/watchlist/{ticker}")
async def add_ticker(ticker: str):
    ticker = ticker.upper().strip()
    if not ticker.isalpha() or len(ticker) > 5:
        raise HTTPException(400, "Invalid ticker")
    await market_source.add_ticker(ticker)
    return {"status": "added", "ticker": ticker}


@app.delete("/api/watchlist/{ticker}")
async def remove_ticker(ticker: str):
    ticker = ticker.upper().strip()
    await market_source.remove_ticker(ticker)
    return {"status": "removed", "ticker": ticker}


@app.get("/api/prices")
async def get_all_prices():
    return {t: u.to_dict() for t, u in price_cache.get_all().items()}


@app.get("/api/prices/{ticker}")
async def get_price(ticker: str):
    update = price_cache.get(ticker.upper())
    if update is None:
        raise HTTPException(404, f"Ticker {ticker} not found")
    return update.to_dict()
```

---

## Testing

### Unit tests — Cache

```python
def test_first_update_is_flat():
    cache = PriceCache()
    update = cache.update("AAPL", 190.00)
    assert update.direction == "flat"
    assert update.previous_price == 190.00

def test_direction_up():
    cache = PriceCache()
    cache.update("AAPL", 190.00)
    update = cache.update("AAPL", 191.00)
    assert update.direction == "up"
    assert update.change == 1.00

def test_version_increments():
    cache = PriceCache()
    v0 = cache.version
    cache.update("AAPL", 190.00)
    assert cache.version == v0 + 1
```

### Unit tests — Simulator

```python
def test_prices_always_positive():
    sim = GBMSimulator(tickers=["AAPL"])
    for _ in range(10_000):
        prices = sim.step()
        assert prices["AAPL"] > 0

def test_correlated_moves():
    """Tech stocks should move more together than uncorrelated stocks."""
    import numpy as np
    sim = GBMSimulator(tickers=["AAPL", "GOOGL", "TSLA"])  # TSLA is independent
    aapl_returns, googl_returns, tsla_returns = [], [], []

    for _ in range(500):
        p = sim.step()
        aapl_returns.append(p["AAPL"])
        googl_returns.append(p["GOOGL"])
        tsla_returns.append(p["TSLA"])

    corr_tech = np.corrcoef(aapl_returns, googl_returns)[0, 1]
    corr_tsla = np.corrcoef(aapl_returns, tsla_returns)[0, 1]
    assert corr_tech > corr_tsla   # tech-tech correlation > tech-TSLA

def test_add_remove_ticker():
    sim = GBMSimulator(tickers=["AAPL"])
    sim.add_ticker("GOOGL")
    assert "GOOGL" in sim.step()
    sim.remove_ticker("GOOGL")
    assert "GOOGL" not in sim.step()
```

### Async integration test — SimulatorDataSource

```python
import asyncio, pytest

@pytest.mark.asyncio
async def test_simulator_source_populates_cache():
    from app.market import PriceCache
    from app.market.simulator import SimulatorDataSource

    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.05)

    await source.start(["AAPL", "GOOGL"])
    await asyncio.sleep(0.2)       # let 4 steps fire

    assert "AAPL" in cache
    assert "GOOGL" in cache
    assert cache.get_price("AAPL") > 0
    await source.stop()

@pytest.mark.asyncio
async def test_add_remove_ticker_via_source():
    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.05)

    await source.start(["AAPL"])
    await source.add_ticker("TSLA")
    await asyncio.sleep(0.1)

    assert "TSLA" in cache

    await source.remove_ticker("TSLA")
    assert "TSLA" not in cache

    await source.stop()
```

### Factory test

```python
import os
from unittest.mock import patch
from app.market import PriceCache, create_market_data_source
from app.market.massive_client import MassiveDataSource
from app.market.simulator import SimulatorDataSource

def test_factory_returns_simulator_without_key():
    with patch.dict(os.environ, {}, clear=True):
        source = create_market_data_source(PriceCache())
    assert isinstance(source, SimulatorDataSource)

def test_factory_returns_massive_with_key():
    with patch.dict(os.environ, {"MASSIVE_API_KEY": "test_key"}):
        source = create_market_data_source(PriceCache())
    assert isinstance(source, MassiveDataSource)
```

---

## Running the Demo

A standalone terminal demo (`backend/market_data_demo.py`) exercises the full simulator stack with a Rich live dashboard:

```bash
cd backend
uv run market_data_demo.py
```

Displays a live-updating table with sparklines for all 10 default tickers. Runs for 60 seconds then prints a session summary.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Push model (data source → cache → SSE) | Decouples ingestion rate from delivery rate; SSE never blocks the poller |
| Single `PriceCache` | One source of truth — SSE and trade execution always see the same price |
| `version` counter in cache | SSE skips JSON serialisation when nothing has changed — saves CPU at idle |
| `asyncio.to_thread()` for Massive | The Massive `RESTClient` is synchronous; wrapping it prevents blocking the event loop |
| `frozen=True` on `PriceUpdate` | Immutable objects are safe to return from the cache without copying |
| Cholesky rebuilt on add/remove | O(n²) but n < 50; cost is negligible compared to the 500ms step interval |
| `SimulatorDataSource` seeds cache on `start()` | SSE clients connecting immediately after startup receive data, not an empty dict |
| Factory selects implementation | All other code is source-agnostic — switching real/simulated data requires zero downstream changes |
