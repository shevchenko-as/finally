# FinAlly — Team Contract

This document is the single source of truth for all cross-team interfaces.
Every agent reads this before writing a single line of code.
No agent may change a contract section that belongs to another agent without updating this file first.

---

## 1. Directory Ownership

| Directory / File | Owner | Notes |
|-----------------|-------|-------|
| `frontend/` | Frontend Engineer | Self-contained Next.js project |
| `backend/app/market/` | ✅ Already complete | Do not modify |
| `backend/app/db/` | Database Engineer | Schema, seed, access layer |
| `backend/app/llm/` | LLM Engineer | LiteLLM integration |
| `backend/app/api/` | Backend API Engineer | FastAPI routers |
| `backend/app/main.py` | Backend API Engineer | App entry point |
| `backend/app/portfolio.py` | Backend API Engineer | Trade execution logic |
| `backend/pyproject.toml` | Backend API Engineer | Add deps as needed |
| `Dockerfile` | DevOps Engineer | Multi-stage build |
| `docker-compose.yml` | DevOps Engineer | Optional convenience wrapper |
| `scripts/` | DevOps Engineer | start/stop scripts |
| `test/` | Integration Tester | Playwright E2E |
| `.env.example` | DevOps Engineer | Template (never commit real keys) |

---

## 2. API Contract (Backend ↔ Frontend)

Base URL: `http://localhost:8000`  
All JSON endpoints use `Content-Type: application/json`.  
All timestamps are ISO 8601 strings (`"2024-01-15T10:30:00Z"`).  
All monetary values are floats rounded to 2 decimal places.

### 2.1 SSE — Live Prices

```
GET /api/stream/prices
Response: text/event-stream
```

Event payload (one JSON object per `data:` line, emitted ~every 500ms):

```json
{
  "AAPL": {
    "ticker": "AAPL",
    "price": 190.50,
    "previous_price": 190.00,
    "timestamp": 1706745600.123,
    "change": 0.50,
    "change_percent": 0.2632,
    "direction": "up"
  },
  "GOOGL": { "...": "same shape" }
}
```

`direction` is always one of: `"up"` | `"down"` | `"flat"`

### 2.2 Watchlist

```
GET /api/watchlist
```
Response `200`:
```json
[
  {
    "ticker": "AAPL",
    "added_at": "2024-01-15T10:30:00Z",
    "price": 190.50,
    "change_percent": 0.26
  }
]
```

```
POST /api/watchlist
Body: { "ticker": "TSLA" }
```
Response `201`:
```json
{ "ticker": "TSLA", "added_at": "2024-01-15T10:30:00Z" }
```
Error `400` (already exists or invalid ticker):
```json
{ "detail": "Ticker TSLA already in watchlist" }
```

```
DELETE /api/watchlist/{ticker}
```
Response `204` (no body).  
Error `404`: `{ "detail": "Ticker AAPL not in watchlist" }`

### 2.3 Portfolio

```
GET /api/portfolio
```
Response `200`:
```json
{
  "cash_balance": 8500.00,
  "total_value": 10234.50,
  "total_cost": 9800.00,
  "unrealized_pnl": 434.50,
  "unrealized_pnl_percent": 4.43,
  "positions": [
    {
      "ticker": "AAPL",
      "quantity": 10.0,
      "avg_cost": 185.00,
      "current_price": 190.50,
      "market_value": 1905.00,
      "unrealized_pnl": 55.00,
      "unrealized_pnl_percent": 2.97,
      "weight": 18.61
    }
  ]
}
```

```
POST /api/portfolio/trade
Body: { "ticker": "AAPL", "side": "buy", "quantity": 10.0 }
```
Response `200`:
```json
{
  "ticker": "AAPL",
  "side": "buy",
  "quantity": 10.0,
  "price": 190.50,
  "total": 1905.00,
  "cash_balance": 8095.00,
  "executed_at": "2024-01-15T10:30:00Z"
}
```
Error `400`:
```json
{ "detail": "Insufficient cash. Need $1905.00, have $500.00" }
```
```json
{ "detail": "Insufficient shares. Have 5.0, selling 10.0" }
```

```
GET /api/portfolio/history
```
Response `200`:
```json
[
  { "total_value": 10000.00, "recorded_at": "2024-01-15T10:00:00Z" },
  { "total_value": 10234.50, "recorded_at": "2024-01-15T10:30:00Z" }
]
```

### 2.4 Chat

```
POST /api/chat
Body: { "message": "Buy 5 shares of NVDA" }
```
Response `200`:
```json
{
  "message": "Done! Bought 5 shares of NVDA at $800.00 ($4,000 total). You have $6,000 cash remaining.",
  "trades_executed": [
    { "ticker": "NVDA", "side": "buy", "quantity": 5.0, "price": 800.00 }
  ],
  "watchlist_changes": [],
  "errors": []
}
```
If LLM call fails → `500`: `{ "detail": "LLM service unavailable" }`

### 2.5 System

```
GET /api/health
```
Response `200`: `{ "status": "ok", "db": "ok", "market": "simulator" | "massive" }`

---

## 3. Database Contract (Database Engineer → Backend API)

### 3.1 SQLite file location

Runtime path: `/app/db/finally.db` (inside container)  
Local dev path: `backend/db/finally.db` (gitignored)

### 3.2 Schema (canonical SQL)

```sql
-- users_profile
CREATE TABLE IF NOT EXISTS users_profile (
    id           TEXT PRIMARY KEY DEFAULT 'default',
    cash_balance REAL NOT NULL DEFAULT 10000.0,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- watchlist
CREATE TABLE IF NOT EXISTS watchlist (
    id       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id  TEXT NOT NULL DEFAULT 'default',
    ticker   TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(user_id, ticker)
);

-- positions
CREATE TABLE IF NOT EXISTS positions (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id    TEXT NOT NULL DEFAULT 'default',
    ticker     TEXT NOT NULL,
    quantity   REAL NOT NULL DEFAULT 0.0,
    avg_cost   REAL NOT NULL DEFAULT 0.0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(user_id, ticker)
);

-- trades
CREATE TABLE IF NOT EXISTS trades (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL DEFAULT 'default',
    ticker      TEXT NOT NULL,
    side        TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    quantity    REAL NOT NULL,
    price       REAL NOT NULL,
    executed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- portfolio_snapshots
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL DEFAULT 'default',
    total_value REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id    TEXT NOT NULL DEFAULT 'default',
    role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    actions    TEXT,  -- JSON string or NULL
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### 3.3 Seed data

Applied once on first startup when `users_profile` has no rows:

```sql
INSERT OR IGNORE INTO users_profile (id, cash_balance) VALUES ('default', 10000.0);

INSERT OR IGNORE INTO watchlist (user_id, ticker) VALUES
  ('default', 'AAPL'), ('default', 'GOOGL'), ('default', 'MSFT'),
  ('default', 'AMZN'), ('default', 'TSLA'),  ('default', 'NVDA'),
  ('default', 'META'), ('default', 'JPM'),   ('default', 'V'),
  ('default', 'NFLX');
```

### 3.4 Python DB access layer

The Database Engineer exposes these functions from `backend/app/db/__init__.py`.
The Backend API Engineer calls only these functions — never raw SQL.

```python
from backend.app.db import (
    get_db,           # context manager → sqlite3.Connection
    init_db,          # creates schema + seeds on first call
    # watchlist
    get_watchlist,           # (user_id="default") → list[dict]
    add_to_watchlist,        # (ticker, user_id="default") → dict | raises ValueError
    remove_from_watchlist,   # (ticker, user_id="default") → None | raises KeyError
    # portfolio
    get_profile,             # (user_id="default") → dict {id, cash_balance, created_at}
    get_positions,           # (user_id="default") → list[dict]
    get_position,            # (ticker, user_id="default") → dict | None
    update_position,         # (ticker, quantity, avg_cost, user_id="default") → None
    remove_position,         # (ticker, user_id="default") → None
    deduct_cash,             # (amount, user_id="default") → new_balance
    add_cash,                # (amount, user_id="default") → new_balance
    record_trade,            # (ticker, side, quantity, price, user_id="default") → dict
    # portfolio snapshots
    add_snapshot,            # (total_value, user_id="default") → None
    get_snapshots,           # (user_id="default", limit=500) → list[dict]
    # chat
    get_chat_history,        # (user_id="default", limit=20) → list[dict]
    save_chat_message,       # (role, content, actions=None, user_id="default") → dict
)
```

All functions raise `ValueError` for business logic errors (duplicate ticker, etc.)  
All functions raise `KeyError` for not-found errors.  
Raw SQLite errors propagate unchanged.

---

## 4. LLM Contract (LLM Engineer → Backend API)

### 4.1 Module location

`backend/app/llm/__init__.py` — exposes one public function:

```python
from backend.app.llm import chat_completion

async def chat_completion(
    user_message: str,
    portfolio_context: dict,
    chat_history: list[dict],  # [{"role": "user"|"assistant", "content": str}, ...]
) -> LLMResponse:
    ...
```

### 4.2 LLMResponse dataclass

```python
from dataclasses import dataclass, field

@dataclass
class TradeAction:
    ticker: str
    side: str   # "buy" | "sell"
    quantity: float

@dataclass
class WatchlistChange:
    ticker: str
    action: str  # "add" | "remove"

@dataclass
class LLMResponse:
    message: str
    trades: list[TradeAction] = field(default_factory=list)
    watchlist_changes: list[WatchlistChange] = field(default_factory=list)
```

### 4.3 Model & provider

- Provider: OpenRouter via LiteLLM
- Model: `openrouter/openai/gpt-oss-120b` with Cerebras inference
- API key: `OPENROUTER_API_KEY` env var
- Structured outputs: `response_format={"type": "json_object"}`

### 4.4 LLM JSON schema the model must return

```json
{
  "message": "string (required)",
  "trades": [
    { "ticker": "string", "side": "buy|sell", "quantity": "number" }
  ],
  "watchlist_changes": [
    { "ticker": "string", "action": "add|remove" }
  ]
}
```

### 4.5 Mock mode

When `LLM_MOCK=true` environment variable is set, `chat_completion()` returns a deterministic mock response without calling OpenRouter:

```python
LLMResponse(
    message="[MOCK] I'm the FinAlly AI assistant. How can I help?",
    trades=[],
    watchlist_changes=[],
)
```

### 4.6 portfolio_context shape passed by Backend API

```python
{
    "cash_balance": 8500.00,
    "total_value": 10234.50,
    "unrealized_pnl": 434.50,
    "positions": [
        {
            "ticker": "AAPL",
            "quantity": 10.0,
            "avg_cost": 185.00,
            "current_price": 190.50,
            "unrealized_pnl": 55.00,
        }
    ],
    "watchlist": ["AAPL", "GOOGL", "MSFT", "..."],
}
```

---

## 5. Frontend Contract

### 5.1 Build output

Next.js must be configured with `output: 'export'` in `next.config.js`.  
Build output goes to `frontend/out/`.  
The Dockerfile copies `frontend/out/` into the Python container as `backend/static/`.  
FastAPI mounts `backend/static/` and serves it at `/`.

### 5.2 Environment during build

No environment variables needed at build time — all API calls go to same-origin `/api/*`.  
No `.env` files in `frontend/`.

### 5.3 API usage

- All fetch calls use relative paths: `/api/portfolio`, `/api/chat`, etc.
- SSE: `new EventSource("/api/stream/prices")`
- No CORS configuration needed — same origin

### 5.4 TypeScript types (matches API contract in section 2)

```typescript
// Copy these into frontend/src/types/index.ts — do not drift from API contract

export interface PriceUpdate {
  ticker: string;
  price: number;
  previous_price: number;
  timestamp: number;
  change: number;
  change_percent: number;
  direction: "up" | "down" | "flat";
}

export interface WatchlistItem {
  ticker: string;
  added_at: string;
  price: number;
  change_percent: number;
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  weight: number;
}

export interface Portfolio {
  cash_balance: number;
  total_value: number;
  total_cost: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  positions: Position[];
}

export interface TradeResult {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
  cash_balance: number;
  executed_at: string;
}

export interface ChatResponse {
  message: string;
  trades_executed: Array<{ ticker: string; side: string; quantity: number; price: number }>;
  watchlist_changes: Array<{ ticker: string; action: string }>;
  errors: string[];
}

export interface PortfolioSnapshot {
  total_value: number;
  recorded_at: string;
}
```

### 5.5 Color scheme (mandatory)

```css
--color-bg-primary:   #0d1117;
--color-bg-secondary: #1a1a2e;
--color-accent-gold:  #ecad0a;
--color-accent-green: #02de02;
--color-accent-orange:#de9802;
--color-border:       #30363d;
--color-text-primary: #e6edf3;
--color-text-muted:   #8b949e;
--color-price-up:     #02de02;
--color-price-down:   #f85149;
```

---

## 6. DevOps Contract

### 6.1 Container entry point

```
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Working directory inside container: `/app/backend`

### 6.2 Volume mount

```
/app/db  →  named Docker volume `finally-data`
```

The backend writes `finally.db` to `/app/db/finally.db`.

### 6.3 Required environment variables

```bash
OPENROUTER_API_KEY=   # required for LLM; LLM_MOCK=true bypasses this
MASSIVE_API_KEY=      # optional; enables real market data
LLM_MOCK=false        # set to "true" for E2E tests
```

### 6.4 Static files inside container

```
/app/backend/static/   ← built frontend (from frontend/out/)
```

FastAPI serves this directory at `/*` (catch-all after `/api/*`).

### 6.5 Health check

Docker HEALTHCHECK: `GET http://localhost:8000/api/health` every 30s.

---

## 7. Integration Test Contract

### 7.1 Infrastructure

`test/docker-compose.test.yml` spins up:
1. The app container with `LLM_MOCK=true`
2. A Playwright container

### 7.2 Scenarios to cover (minimum)

1. Page loads → default watchlist (10 tickers) visible, cash = $10,000
2. Prices are streaming (values change within 3 seconds)
3. Add a ticker → appears in watchlist
4. Remove a ticker → disappears from watchlist
5. Buy shares → cash decreases, position appears in portfolio
6. Sell shares → cash increases, position updates
7. AI chat (mock): send message → response appears
8. SSE reconnect → disconnect, verify reconnection indicator

### 7.3 Test environment

- App URL inside test network: `http://app:8000`
- `LLM_MOCK=true` must be set
- Tests must be fully deterministic (no real LLM, no Massive API)

---

## 8. Spawn Order

To avoid git conflicts, agents work in this order:

**Round 1 — Parallel (no inter-agent dependencies)**
- `feature/db` — Database Engineer
- `feature/llm` — LLM Engineer
- `feature/frontend` — Frontend Engineer
- `feature/devops` — DevOps Engineer

**Round 2 — After Round 1 is merged into main**
- `feature/backend-api` — Backend API Engineer (imports db + llm modules)

**Round 3 — After Round 2 is merged**
- `feature/e2e-tests` — Integration Tester (needs full running app)
