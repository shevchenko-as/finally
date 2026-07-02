import { test, expect } from '@playwright/test';

test.describe('06 - AI Chat', () => {
  test('chat endpoint returns mock response', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: { message: 'What is my portfolio?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Response must have a reply field
    expect(data).toHaveProperty('reply');
    expect(typeof data.reply).toBe('string');
    expect(data.reply.length).toBeGreaterThan(0);

    // With LLM_MOCK=true, response should be the mock message
    expect(data.reply).toContain('[MOCK]');
  });

  test('mock response content matches expected pattern', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: { message: 'Hello' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Mock LLM returns deterministic response
    expect(data.reply).toMatch(/\[MOCK\]/);
  });

  test('chat response includes trades array', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: { message: 'What is my portfolio?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Response shape should include trades_executed
    expect(data).toHaveProperty('trades_executed');
    expect(Array.isArray(data.trades_executed)).toBe(true);
  });

  test('chat history is persisted', async ({ request }) => {
    const message = `Test message ${Date.now()}`;
    await request.post('/api/chat', { data: { message } });

    const historyRes = await request.get('/api/chat/history');
    expect(historyRes.ok()).toBeTruthy();
    const history = await historyRes.json() as Array<{ role: string; content: string }>;

    // The message should be in history
    const found = history.some(
      (item: { role: string; content: string }) =>
        item.role === 'user' && item.content === message
    );
    expect(found).toBe(true);
  });

  test('page loads AI chat section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const content = await page.content();
    // Page should be rendered with content
    expect(content.length).toBeGreaterThan(500);
  });
});
