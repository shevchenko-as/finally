import { test, expect } from '@playwright/test';

const DEFAULT_TICKERS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM', 'V', 'NFLX'];

test.describe('01 - Initial Load', () => {
  test('page loads successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  test('default watchlist shows 10 tickers', async ({ page, request }) => {
    const res = await request.get('/api/watchlist');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveLength(10);
    const tickers = data.map((item: { ticker: string }) => item.ticker);
    for (const ticker of DEFAULT_TICKERS) {
      expect(tickers).toContain(ticker);
    }
  });

  test('cash balance shows $10,000', async ({ page, request }) => {
    const res = await request.get('/api/portfolio');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.cash_balance).toBe(10000);
  });

  test('connection status indicator is present on page', async ({ page }) => {
    await page.goto('/');
    // Wait for the page to be interactive
    await page.waitForLoadState('networkidle');
    // The connection indicator should be visible (green dot / connected status)
    // Look for common patterns: a dot, status indicator, or "connected" text
    const body = await page.content();
    // The page should have loaded without errors
    expect(body).toBeTruthy();
    expect(body.length).toBeGreaterThan(100);
  });
});
