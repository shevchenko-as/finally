# Massive API Reference (formerly Polygon.io)

Reference documentation for the Massive (formerly Polygon.io) REST API as used in FinAlly.

---

## Overview

| Item | Value |
|------|-------|
| Base URL | `https://api.massive.com` (legacy `https://api.polygon.io` still supported) |
| Python package | `massive` (`uv add massive` / `pip install -U massive`) |
| Min Python | 3.9+ |
| Auth | `MASSIVE_API_KEY` env var, or pass `api_key=` to `RESTClient` |
| Auth header | `Authorization: Bearer <API_KEY>` (handled automatically by the client) |

---

## Rate Limits

| Tier | Limit | Recommended poll interval |
|------|-------|--------------------------|
| Free | 5 requests / minute | 15 s |
| Paid (all tiers) | Unlimited (stay under ~100 req/s) | 2–5 s |

FinAlly uses a single `get_snapshot_all()` call per poll cycle — one API call covers all tickers. This makes free-tier usage practical even with a large watchlist.

---

## Client Initialization

```python
from massive import RESTClient

# Reads MASSIVE_API_KEY from environment automatically
client = RESTClient()

# Or pass explicitly
client = RESTClient(api_key="your_key_here")
```

The client is **synchronous**. In async contexts (FastAPI, asyncio) wrap calls with `asyncio.to_thread()` to avoid blocking the event loop:

```python
import asyncio
from massive import RESTClient
from massive.rest.models import SnapshotMarketType

client = RESTClient()

snapshots = await asyncio.to_thread(
    client.get_snapshot_all,
    market_type=SnapshotMarketType.STOCKS,
    tickers=["AAPL", "GOOGL", "MSFT"],
)
```

---

## Endpoints Used in FinAlly

### 1. Snapshot — All Tickers (Primary Endpoint)

**The main endpoint for FinAlly's live polling.** Returns current price data for multiple tickers in a single API call.

**REST:** `GET /v2/snapshot/locale/us/markets/stocks/tickers?tickers=AAPL,GOOGL,MSFT`

```python
from massive import RESTClient
from massive.rest.models import SnapshotMarketType

client = RESTClient()

snapshots = client.get_snapshot_all(
    market_type=SnapshotMarketType.STOCKS,
    tickers=["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"],
)

for snap in snapshots:
    print(f"{snap.ticker}: ${snap.last_trade.price:.2f}")
    print(f"  Day change: {snap.day.change_percent:+.2f}%")
    print(f"  OHLC: O={snap.day.open} H={snap.day.high} L={snap.day.low} C={snap.day.close}")
    print(f"  Prev close: ${snap.day.previous_close}")
    print(f"  Volume: {snap.day.volume:,}")
```

**Response structure** (per ticker):

```json
{
  "ticker": "AAPL",
  "day": {
    "open": 189.50,
    "high": 191.20,
    "low": 188.30,
    "close": 190.40,
    "volume": 54321000,
    "volume_weighted_average_price": 190.10,
    "previous_close": 188.90,
    "change": 1.50,
    "change_percent": 0.79
  },
  "last_trade": {
    "price": 190.40,
    "size": 100,
    "exchange": "XNAS",
    "timestamp": 1706745600000
  },
  "last_quote": {
    "bid_price": 190.38,
    "ask_price": 190.42,
    "bid_size": 300,
    "ask_size": 200,
    "spread": 0.04,
    "timestamp": 1706745600100
  },
  "prev_daily_bar": { "...": "previous day OHLCV" }
}
```

**Fields extracted by FinAlly:**

| Field | Used for |
|-------|----------|
| `last_trade.price` | Current price (display + trade execution) |
| `last_trade.timestamp` | When the price was recorded (ms → s) |
| `day.previous_close` | Baseline for day change calculation |
| `day.change_percent` | Day change % for the watchlist display |

---

### 2. Single Ticker Snapshot

For fetching detailed data on one ticker (e.g., a detail view when a user clicks a ticker).

```python
from massive.rest.models import SnapshotMarketType

snapshot = client.get_snapshot_ticker(
    market_type=SnapshotMarketType.STOCKS,
    ticker="AAPL",
)

print(f"Price: ${snapshot.last_trade.price:.2f}")
print(f"Bid/Ask: ${snapshot.last_quote.bid_price} / ${snapshot.last_quote.ask_price}")
print(f"Spread: ${snapshot.last_quote.spread:.4f}")
print(f"Day range: ${snapshot.day.low} – ${snapshot.day.high}")
```

---

### 3. Previous Close

Previous day's OHLCV bar. Useful for seeding the cache before the first snapshot poll returns.

**REST:** `GET /v2/aggs/ticker/{ticker}/prev`

```python
results = client.get_previous_close_agg(ticker="AAPL")

for agg in results:
    print(f"Previous close: ${agg.close:.2f}")
    print(f"OHLC: O={agg.open} H={agg.high} L={agg.low} C={agg.close}")
    print(f"Volume: {agg.volume:,}")
    print(f"Date (Unix ms): {agg.timestamp}")
```

---

### 4. Aggregates (Historical Bars)

Historical OHLCV bars over a date range. Not required for live polling but needed if FinAlly adds a price history chart.

**REST:** `GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}`

```python
aggs = list(client.list_aggs(
    ticker="AAPL",
    multiplier=1,
    timespan="day",        # "minute", "hour", "day", "week", "month"
    from_="2024-01-01",
    to="2024-03-31",
    limit=50000,
))

for a in aggs:
    print(f"O={a.open:.2f} H={a.high:.2f} L={a.low:.2f} C={a.close:.2f} V={a.volume:,} t={a.timestamp}")
```

---

### 5. Last Trade / Last Quote

Lightweight endpoints for a single, up-to-the-millisecond data point.

```python
# Most recent trade
trade = client.get_last_trade(ticker="AAPL")
print(f"Last trade: ${trade.price:.2f} × {trade.size} shares")

# Most recent NBBO (National Best Bid and Offer)
quote = client.get_last_quote(ticker="AAPL")
print(f"Bid: ${quote.bid:.2f} × {quote.bid_size}")
print(f"Ask: ${quote.ask:.2f} × {quote.ask_size}")
```

---

## How FinAlly Polls the API

The `MassiveDataSource` background task runs a loop:

1. Collect all tickers from the active watchlist
2. Call `get_snapshot_all()` — **one API call covers all tickers**
3. Extract `last_trade.price` and `last_trade.timestamp` from each snapshot
4. Write to the shared `PriceCache`
5. Sleep for `poll_interval`, then repeat

```python
import asyncio
import logging
from massive import RESTClient
from massive.rest.models import SnapshotMarketType

logger = logging.getLogger(__name__)


async def poll_loop(api_key: str, get_tickers, price_cache, interval: float = 15.0):
    """Minimal standalone example of the Massive polling loop."""
    client = RESTClient(api_key=api_key)

    while True:
        tickers = get_tickers()
        if tickers:
            try:
                # Run the synchronous client in a thread pool
                snapshots = await asyncio.to_thread(
                    client.get_snapshot_all,
                    market_type=SnapshotMarketType.STOCKS,
                    tickers=tickers,
                )
                for snap in snapshots:
                    price_cache.update(
                        ticker=snap.ticker,
                        price=snap.last_trade.price,
                        timestamp=snap.last_trade.timestamp / 1000.0,  # ms → seconds
                    )
                logger.debug("Polled %d tickers", len(tickers))
            except Exception as e:
                logger.error("Poll failed: %s", e)

        await asyncio.sleep(interval)
```

---

## Error Handling

| HTTP status | Meaning | Action |
|-------------|---------|--------|
| 401 | Invalid API key | Log error, stop retrying |
| 403 | Plan doesn't include this endpoint | Log error |
| 429 | Rate limit exceeded | Increase poll interval |
| 5xx | Server error | The client retries 3× automatically; log if all retries fail |

FinAlly's `_poll_once()` catches all exceptions and logs them without re-raising, so a transient network failure doesn't crash the polling loop — it just misses one cycle.

---

## Notes

- `get_snapshot_all()` is efficient: one call → all tickers. Never poll each ticker individually on the free tier.
- Timestamps are Unix **milliseconds** — divide by 1000 when storing as Unix seconds.
- During market-closed hours `last_trade.price` is the last recorded trade price (may include after-hours).
- The `day` object resets at market open; before the first trade of the day, values reflect the previous session.
- `SnapshotMarketType.STOCKS` is an enum — don't pass the string `"stocks"` directly.
