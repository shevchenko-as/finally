# FinAlly E2E Tests

Playwright-based end-to-end test suite for the FinAlly application.

## Test Scenarios

| File | Scenario |
|------|----------|
| `01-initial-load.spec.ts` | Page loads, default watchlist (10 tickers), cash = $10,000 |
| `02-price-streaming.spec.ts` | SSE prices update within 3 seconds |
| `03-watchlist.spec.ts` | Add/remove tickers, duplicate and not-found error handling |
| `04-trading.spec.ts` | Buy/sell shares, cash changes, position updates, error cases |
| `05-portfolio.spec.ts` | Portfolio shape, positions data, P&L fields, snapshots |
| `06-ai-chat.spec.ts` | Chat endpoint with LLM_MOCK, response shape, history |
| `07-sse-resilience.spec.ts` | SSE disconnect and reconnect, app stays functional |
| `08-api-health.spec.ts` | Direct API checks: health, watchlist, portfolio, history |

## Run with Docker (recommended)

```bash
cd test
docker compose -f docker-compose.test.yml up --build --exit-code-from playwright
```

This spins up the app with `LLM_MOCK=true` and runs all tests inside a Playwright container.

## Run locally (app must be running on port 8000)

```bash
cd test
npm install
npx playwright install chromium
BASE_URL=http://localhost:8000 npx playwright test
```

## View report

```bash
cd test
npm run test:report
```

## Notes

- `LLM_MOCK=true` makes AI chat deterministic: responses contain `[MOCK]`
- Tests are independent — each uses a fresh page/request context
- Retries: 2 (configured in `playwright.config.ts`)
- Timeout per test: 60 seconds
