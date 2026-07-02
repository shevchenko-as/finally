import { test, expect } from '@playwright/test';

test.describe('08 - API Health Checks', () => {
  test('GET /api/health returns {status: "ok"}', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  test('GET /api/watchlist returns array of 10 items', async ({ request }) => {
    const res = await request.get('/api/watchlist');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(10);
  });

  test('GET /api/watchlist items have required fields', async ({ request }) => {
    const res = await request.get('/api/watchlist');
    const data = await res.json() as Array<Record<string, unknown>>;
    for (const item of data) {
      expect(item).toHaveProperty('ticker');
      expect(item).toHaveProperty('price');
      expect(item).toHaveProperty('added_at');
      expect(typeof item.ticker).toBe('string');
      expect(typeof item.price).toBe('number');
    }
  });

  test('GET /api/portfolio returns correct shape with cash_balance', async ({ request }) => {
    const res = await request.get('/api/portfolio');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data).toHaveProperty('cash_balance');
    expect(data).toHaveProperty('positions');
    expect(data).toHaveProperty('total_value');
    expect(data).toHaveProperty('total_pnl');
    expect(typeof data.cash_balance).toBe('number');
    expect(Array.isArray(data.positions)).toBe(true);
    expect(data.cash_balance).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/portfolio/snapshots returns array', async ({ request }) => {
    const res = await request.get('/api/portfolio/snapshots');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/chat/history returns array', async ({ request }) => {
    const res = await request.get('/api/chat/history');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('unknown route returns non-500 response', async ({ request }) => {
    const res = await request.get('/api/nonexistent');
    // Should get 404, not 500
    expect(res.status()).toBe(404);
  });
});
