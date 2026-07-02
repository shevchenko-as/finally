import { test, expect } from '@playwright/test';

test.describe('03 - Watchlist Management', () => {
  test('add ticker PYPL → appears in watchlist', async ({ request }) => {
    // Remove first in case it exists from a previous run
    await request.delete('/api/watchlist/PYPL').catch(() => {});

    const addRes = await request.post('/api/watchlist', {
      data: { ticker: 'PYPL' },
    });
    expect(addRes.status()).toBe(201);

    const listRes = await request.get('/api/watchlist');
    const data = await listRes.json() as Array<{ ticker: string }>;
    expect(data.some(item => item.ticker === 'PYPL')).toBe(true);

    // Cleanup
    await request.delete('/api/watchlist/PYPL');
  });

  test('remove ticker PYPL → disappears from watchlist', async ({ request }) => {
    // Ensure it exists
    await request.post('/api/watchlist', { data: { ticker: 'PYPL' } }).catch(() => {});

    const delRes = await request.delete('/api/watchlist/PYPL');
    expect(delRes.ok()).toBeTruthy();

    const listRes = await request.get('/api/watchlist');
    const data = await listRes.json() as Array<{ ticker: string }>;
    expect(data.some(item => item.ticker === 'PYPL')).toBe(false);
  });

  test('add duplicate ticker → error shown', async ({ request }) => {
    // AAPL is always in the default watchlist
    const addRes = await request.post('/api/watchlist', {
      data: { ticker: 'AAPL' },
    });
    // Should return 4xx error for duplicate
    expect(addRes.status()).toBeGreaterThanOrEqual(400);
  });

  test('remove non-existent ticker → handled gracefully', async ({ request }) => {
    const delRes = await request.delete('/api/watchlist/NONEXISTENT999');
    // Should return 4xx (not 5xx server crash)
    expect(delRes.status()).toBeGreaterThanOrEqual(400);
    expect(delRes.status()).toBeLessThan(500);
  });
});
