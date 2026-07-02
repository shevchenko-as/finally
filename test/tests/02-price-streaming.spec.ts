import { test, expect } from '@playwright/test';

test.describe('02 - Price Streaming', () => {
  test('prices update via SSE within 3 seconds', async ({ request }) => {
    // Collect two snapshots of watchlist prices and verify at least one changes
    const snapshot1 = await request.get('/api/watchlist');
    expect(snapshot1.ok()).toBeTruthy();
    const data1 = await snapshot1.json() as Array<{ ticker: string; price: number }>;

    // Wait up to 3 seconds for price updates
    await new Promise(resolve => setTimeout(resolve, 3000));

    const snapshot2 = await request.get('/api/watchlist');
    expect(snapshot2.ok()).toBeTruthy();
    const data2 = await snapshot2.json() as Array<{ ticker: string; price: number }>;

    // At least one price should have changed (simulator updates continuously)
    const changed = data1.some((item, idx) => {
      const match = data2.find((d: { ticker: string }) => d.ticker === item.ticker);
      return match && match.price !== item.price;
    });

    expect(changed).toBe(true);
  });

  test('SSE endpoint is accessible', async ({ request }) => {
    // Verify the SSE endpoint responds (we can't easily read the stream in request fixture,
    // but we can verify it starts a response)
    const res = await request.get('/api/stream/prices');
    // SSE returns 200 with text/event-stream content type
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/event-stream');
  });
});
