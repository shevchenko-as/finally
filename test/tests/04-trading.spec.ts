import { test, expect } from '@playwright/test';

test.describe('04 - Trading', () => {
  test('buy 5 shares of AAPL: cash decreases, position appears', async ({ request }) => {
    // Get initial state
    const portfolioBefore = await (await request.get('/api/portfolio')).json();
    const cashBefore: number = portfolioBefore.cash_balance;

    // Get current AAPL price
    const watchlist = await (await request.get('/api/watchlist')).json() as Array<{ ticker: string; price: number }>;
    const aaplItem = watchlist.find((item: { ticker: string }) => item.ticker === 'AAPL');
    expect(aaplItem).toBeTruthy();
    const aaplPrice: number = aaplItem!.price;

    // Buy 5 shares
    const buyRes = await request.post('/api/portfolio/trade', {
      data: { ticker: 'AAPL', side: 'buy', quantity: 5 },
    });
    expect(buyRes.ok()).toBeTruthy();

    const portfolioAfter = await (await request.get('/api/portfolio')).json();
    const cashAfter: number = portfolioAfter.cash_balance;

    // Cash should decrease by approximately 5 * price
    expect(cashBefore - cashAfter).toBeCloseTo(5 * aaplPrice, 0);

    // AAPL position should exist
    const aaplPosition = portfolioAfter.positions.find(
      (p: { ticker: string }) => p.ticker === 'AAPL'
    );
    expect(aaplPosition).toBeTruthy();
    expect(aaplPosition.quantity).toBeGreaterThanOrEqual(5);
  });

  test('sell 2 shares of AAPL: cash increases, position updates', async ({ request }) => {
    // Ensure we have at least 5 AAPL shares
    const portfolioBefore = await (await request.get('/api/portfolio')).json();
    const existingPosition = portfolioBefore.positions.find(
      (p: { ticker: string }) => p.ticker === 'AAPL'
    );

    if (!existingPosition || existingPosition.quantity < 5) {
      // Buy enough shares first
      await request.post('/api/portfolio/trade', {
        data: { ticker: 'AAPL', side: 'buy', quantity: 5 },
      });
    }

    const portfolioMid = await (await request.get('/api/portfolio')).json();
    const cashMid: number = portfolioMid.cash_balance;
    const aaplQtyBefore: number = portfolioMid.positions.find(
      (p: { ticker: string }) => p.ticker === 'AAPL'
    )?.quantity ?? 0;

    // Sell 2 shares
    const sellRes = await request.post('/api/portfolio/trade', {
      data: { ticker: 'AAPL', side: 'sell', quantity: 2 },
    });
    expect(sellRes.ok()).toBeTruthy();

    const portfolioAfter = await (await request.get('/api/portfolio')).json();
    const cashAfter: number = portfolioAfter.cash_balance;

    // Cash should increase
    expect(cashAfter).toBeGreaterThan(cashMid);

    // Position quantity should decrease by 2
    const aaplPositionAfter = portfolioAfter.positions.find(
      (p: { ticker: string }) => p.ticker === 'AAPL'
    );
    expect(aaplPositionAfter).toBeTruthy();
    expect(aaplPositionAfter.quantity).toBeCloseTo(aaplQtyBefore - 2, 5);
  });

  test('buy with insufficient cash → error', async ({ request }) => {
    // Attempt to buy an absurdly large quantity
    const buyRes = await request.post('/api/portfolio/trade', {
      data: { ticker: 'AAPL', side: 'buy', quantity: 1000000 },
    });
    expect(buyRes.status()).toBe(400);
    const body = await buyRes.json();
    expect(body.detail).toContain('Insufficient cash');
  });

  test('sell more than owned → error', async ({ request }) => {
    const sellRes = await request.post('/api/portfolio/trade', {
      data: { ticker: 'AAPL', side: 'sell', quantity: 999999 },
    });
    expect(sellRes.status()).toBe(400);
    const body = await sellRes.json();
    expect(body.detail).toContain('Insufficient shares');
  });
});
