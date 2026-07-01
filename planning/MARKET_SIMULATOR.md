# Market Simulator Design

Approach and code structure for simulating realistic stock prices when `MASSIVE_API_KEY` is not set.

---

## Overview

The simulator uses **Geometric Brownian Motion (GBM)** — the same stochastic process that underlies Black-Scholes option pricing. Prices evolve continuously with random noise, can never go negative, and produce the lognormal distribution seen in real markets.

The simulator runs at 500ms intervals, producing a continuous stream of small, realistic price moves that make the FinAlly dashboard feel alive even without a live data subscription.

---

## GBM Mathematics

At each time step, a price evolves as:

```
S(t + dt) = S(t) × exp( (μ - σ²/2) × dt  +  σ × √dt × Z )
```

| Symbol | Meaning | Typical value |
|--------|---------|---------------|
| `S(t)` | Current price | — |
| `μ` (mu) | Annualized drift (expected return) | 0.05 (5%) |
| `σ` (sigma) | Annualized volatility | 0.20–0.50 |
| `dt` | Time step as a fraction of a trading year | ~8.5 × 10⁻⁸ |
| `Z` | Standard normal random variable N(0, 1) | drawn each step |

**Why `exp()`?** The multiplicative form ensures prices can never reach zero or go negative, and produces the right lognormal distribution.

**Computing `dt` for 500ms ticks:**
```
dt = 0.5 seconds / (252 trading days × 6.5 hours/day × 3600 s/hour)
   = 0.5 / 5,896,800
   ≈ 8.48 × 10⁻⁸
```

This tiny `dt` produces sub-cent moves per tick — prices drift realistically over minutes rather than jumping around unrealistically.

---

## Correlated Moves

Real stocks don't move independently — tech stocks tend to move together (macro news, sector rotation, risk-off events). The simulator replicates this with **Cholesky decomposition**.

### The math

Given a correlation matrix `C`, compute its Cholesky factor `L` such that `L × Lᵀ = C`.

For `n` tickers, draw `n` independent normals `Z_ind ~ N(0, I)`, then:
```
Z_correlated = L × Z_ind
```

`Z_correlated` has the desired pairwise correlations encoded in `C`.

### Correlation structure

| Pair | ρ (rho) | Rationale |
|------|---------|-----------|
| Tech × Tech (AAPL, GOOGL, MSFT, AMZN, META, NVDA, NFLX) | 0.6 | Sector moves together |
| Finance × Finance (JPM, V) | 0.5 | Sector moves together |
| TSLA × anything | 0.3 | TSLA does its own thing |
| Tech × Finance | 0.3 | Cross-sector baseline |
| Unknown tickers | 0.3 | Default |

The correlation matrix is guaranteed to be positive semi-definite for all valid inputs (pairwise correlations ≤ 1), so Cholesky decomposition always succeeds.

---

## Random Events

Every step, each ticker has a small probability (`event_probability = 0.001`) of a sudden shock — a 2–5% move in either direction:

```python
if random.random() < event_probability:
    shock = random.uniform(0.02, 0.05) * random.choice([-1, 1])
    price *= (1 + shock)
```

With 10 tickers at 2 ticks/second, expect an event somewhere roughly every 50 seconds. These shocks add visual drama and make the dashboard interesting to watch.

---

## Seed Prices and Parameters

Defined in `backend/app/market/seed_prices.py`.

### Starting prices

```python
SEED_PRICES: dict[str, float] = {
    "AAPL": 190.00,
    "GOOGL": 175.00,
    "MSFT": 420.00,
    "AMZN": 185.00,
    "TSLA": 250.00,
    "NVDA": 800.00,
    "META": 500.00,
    "JPM": 195.00,
    "V": 280.00,
    "NFLX": 600.00,
}
```

Tickers not in this list (dynamically added) start at a random price between $50–$300.

### Per-ticker GBM parameters

```python
TICKER_PARAMS: dict[str, dict[str, float]] = {
    "AAPL":  {"sigma": 0.22, "mu": 0.05},   # Moderate vol
    "GOOGL": {"sigma": 0.25, "mu": 0.05},
    "MSFT":  {"sigma": 0.20, "mu": 0.05},   # Lowest vol in tech
    "AMZN":  {"sigma": 0.28, "mu": 0.05},
    "TSLA":  {"sigma": 0.50, "mu": 0.03},   # Very high vol
    "NVDA":  {"sigma": 0.40, "mu": 0.08},   # High vol, strong drift
    "META":  {"sigma": 0.30, "mu": 0.05},
    "JPM":   {"sigma": 0.18, "mu": 0.04},   # Low vol (bank)
    "V":     {"sigma": 0.17, "mu": 0.04},   # Lowest vol overall
    "NFLX":  {"sigma": 0.35, "mu": 0.05},
}

DEFAULT_PARAMS: dict[str, float] = {"sigma": 0.25, "mu": 0.05}
```

### Correlation constants

```python
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

## GBMSimulator Implementation

Defined in `backend/app/market/simulator.py`.

```python
import math
import random
import logging
import numpy as np
from .seed_prices import (
    SEED_PRICES, TICKER_PARAMS, DEFAULT_PARAMS,
    CORRELATION_GROUPS, INTRA_TECH_CORR, INTRA_FINANCE_CORR,
    CROSS_GROUP_CORR, TSLA_CORR,
)

logger = logging.getLogger(__name__)


class GBMSimulator:
    """Correlated GBM price simulator for multiple tickers.

    Math:
        S(t+dt) = S(t) * exp((mu - sigma²/2)*dt + sigma*√dt*Z)

    Z is drawn from a multivariate normal with the correlation matrix
    built from sector groups; the Cholesky factor is pre-computed for speed.
    """

    TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600   # 5,896,800
    DEFAULT_DT = 0.5 / TRADING_SECONDS_PER_YEAR    # ~8.48e-8  (for 500ms ticks)

    def __init__(
        self,
        tickers: list[str],
        dt: float = DEFAULT_DT,
        event_probability: float = 0.001,
    ) -> None:
        self._dt = dt
        self._event_prob = event_probability
        self._tickers: list[str] = []
        self._prices: dict[str, float] = {}
        self._params: dict[str, dict[str, float]] = {}
        self._cholesky: np.ndarray | None = None

        # Batch initialization — rebuild Cholesky once at the end
        for ticker in tickers:
            self._add_ticker_internal(ticker)
        self._rebuild_cholesky()

    # ── Public API ──────────────────────────────────────────────────────────

    def step(self) -> dict[str, float]:
        """Advance all tickers by one dt. Returns {ticker: new_price}.

        Hot path — called every 500ms. Avoid unnecessary allocations here.
        """
        n = len(self._tickers)
        if n == 0:
            return {}

        z_ind = np.random.standard_normal(n)
        z = self._cholesky @ z_ind if self._cholesky is not None else z_ind

        result: dict[str, float] = {}
        for i, ticker in enumerate(self._tickers):
            mu = self._params[ticker]["mu"]
            sigma = self._params[ticker]["sigma"]

            # GBM update
            drift = (mu - 0.5 * sigma ** 2) * self._dt
            diffusion = sigma * math.sqrt(self._dt) * z[i]
            self._prices[ticker] *= math.exp(drift + diffusion)

            # Random shock event
            if random.random() < self._event_prob:
                magnitude = random.uniform(0.02, 0.05)
                direction = random.choice([-1, 1])
                self._prices[ticker] *= 1 + magnitude * direction
                logger.debug(
                    "Event on %s: %+.1f%%", ticker, magnitude * direction * 100
                )

            result[ticker] = round(self._prices[ticker], 2)

        return result

    def add_ticker(self, ticker: str) -> None:
        """Add a ticker. Rebuilds the Cholesky matrix — O(n²)."""
        if ticker in self._prices:
            return
        self._add_ticker_internal(ticker)
        self._rebuild_cholesky()

    def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker. Rebuilds the Cholesky matrix — O(n²)."""
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
        """Add a ticker without touching the Cholesky matrix."""
        self._tickers.append(ticker)
        self._prices[ticker] = SEED_PRICES.get(ticker, random.uniform(50.0, 300.0))
        self._params[ticker] = dict(TICKER_PARAMS.get(ticker, DEFAULT_PARAMS))

    def _rebuild_cholesky(self) -> None:
        """Recompute L from the pairwise correlation matrix.

        O(n²) but n < 50 in practice — negligible cost.
        Called on every add/remove; amortized over the 500ms step loop.
        """
        n = len(self._tickers)
        if n <= 1:
            self._cholesky = None
            return

        corr = np.eye(n)
        for i in range(n):
            for j in range(i + 1, n):
                rho = self._pairwise_correlation(self._tickers[i], self._tickers[j])
                corr[i, j] = rho
                corr[j, i] = rho

        self._cholesky = np.linalg.cholesky(corr)

    @staticmethod
    def _pairwise_correlation(t1: str, t2: str) -> float:
        tech = CORRELATION_GROUPS["tech"]
        finance = CORRELATION_GROUPS["finance"]

        if t1 == "TSLA" or t2 == "TSLA":
            return TSLA_CORR
        if t1 in tech and t2 in tech:
            return INTRA_TECH_CORR
        if t1 in finance and t2 in finance:
            return INTRA_FINANCE_CORR
        return CROSS_GROUP_CORR
```

---

## SimulatorDataSource Implementation

Also in `backend/app/market/simulator.py`. Wraps `GBMSimulator` in an asyncio background task and connects it to `PriceCache`.

```python
import asyncio
import logging
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)


class SimulatorDataSource(MarketDataSource):
    """Runs GBMSimulator in an asyncio loop, writing to PriceCache every 500ms."""

    def __init__(
        self,
        price_cache: PriceCache,
        update_interval: float = 0.5,
        event_probability: float = 0.001,
    ) -> None:
        self._cache = price_cache
        self._interval = update_interval
        self._event_prob = event_probability
        self._sim: GBMSimulator | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._sim = GBMSimulator(tickers=tickers, event_probability=self._event_prob)
        # Seed cache immediately — SSE has data before the first step fires
        for ticker in tickers:
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)
        self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")
        logger.info("Simulator started with %d tickers", len(tickers))

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("Simulator stopped")

    async def add_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.add_ticker(ticker)
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)
            logger.info("Simulator: added %s", ticker)

    async def remove_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.remove_ticker(ticker)
        self._cache.remove(ticker)
        logger.info("Simulator: removed %s", ticker)

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

---

## File Structure

```
backend/
  app/
    market/
      simulator.py     # GBMSimulator + SimulatorDataSource
      seed_prices.py   # SEED_PRICES, TICKER_PARAMS, CORRELATION_GROUPS, correlation constants
```

`seed_prices.py` contains only constants — no logic. `simulator.py` contains both classes; they are in the same file because `SimulatorDataSource` is a thin async shell around `GBMSimulator` and it makes no sense to split them.

---

## Behavior Notes

| Property | Explanation |
|----------|-------------|
| Prices never go negative | `exp()` is always positive — a fundamental property of GBM |
| Sub-cent moves per tick | `dt ≈ 8.5e-8` produces tiny per-step increments that accumulate naturally |
| Realistic intraday range | With `sigma=0.50` (TSLA), a simulated trading day produces roughly the right intraday range |
| Correlation rebuilds | `_rebuild_cholesky()` is O(n²) in the number of tickers. With n < 50, this is negligible (< 1ms) |
| Events are per-ticker | With 10 tickers at 2 ticks/s, expect ~1 event every 50 seconds across the board |
| New tickers | Added tickers get seed prices from `SEED_PRICES`, or a random $50–$300 if unknown |
| Thread safety | `GBMSimulator` is not thread-safe — it's only called from the single asyncio background task |
