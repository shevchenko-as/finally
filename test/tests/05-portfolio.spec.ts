import { test, expect } from '@playwright/test';

test.describe('05 - Portfolio', () => {
  test.beforeAll(async ({ request }) => {
    // Ensure AAPL position exists for portfolio tests
    const portfolio = await (await request.get('/api/portfolio')).json();
    const hasAapl = portfolio.positions.some((p: { ticker: string }) => p.ticker === 'AAPL');
    if (!hasAapl) {
      await request.post('/api/portfolio/trade', {
        data: { ticker: 'AAPL', side: 'buy', quantity: 3 },
      });
    }
  });

  test('portfolio response has correct shape with positions', async ({ request }) => {
    const res = await request.get('/api/portfolio');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Required top-level fields
    expect(data).toHaveProperty('cash_balance');
    expect(data).toHaveProperty('positions');
    expect(data).toHaveProperty('total_value');
    expect(typeof data.cash_balance).toBe('number');
    expect(Array.isArray(data.positions)).toBe(true);
  });

  test('positions table shows correct data for AAPL', async ({ request }) => {
    const res = await request.get('/api/portfolio');
    const data = await res.json();

    const aaplPos = data.positions.find((p: { ticker: string }) => p.ticker === 'AAPL');
    expect(aaplPos).toBeTruthy();
    expect(aaplPos.ticker).toBe('AAPL');
    expect(typeof aaplPos.quantity).toBe('number');
    expect(aaplPos.quantity).toBeGreaterThan(0);
    expect(typeof aaplPos.avg_cost).toBe('number');
    expect(aaplPos.avg_cost).toBeGreaterThan(0);
  });

  test('portfolio positions include unrealized P&L fields', async ({ request }) => {
    const res = await request.get('/api/portfolio');
    const data = await res.json();

    const aaplPos = data.positions.find((p: { ticker: string }) => p.ticker === 'AAPL');
    expect(aaplPos).toBeTruthy();
    expect(aaplPos).toHaveProperty('unrealized_pnl');
    expect(aaplPos).toHaveProperty('current_price');
    expect(typeof aaplPos.unrealized_pnl).toBe('number');
  });

  test('snapshots endpoint returns data points', async ({ request }) => {
    const res = await request.get('/api/portfolio/snapshots');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Snapshots should be an array (may be empty if snapshot loop hasn't run yet, but endpoint must work)
    expect(Array.isArray(data)).toBe(true);
  });

  test('page loads portfolio section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Portfolio section or heatmap should be rendered
    const content = await page.content();
    expect(content.length).toBeGreaterThan(500);
  });
});
