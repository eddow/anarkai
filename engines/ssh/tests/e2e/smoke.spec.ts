import { test, expect } from '@playwright/test';

test('no console errors or warnings', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');

  // Wait for the app to load
  await page.waitForSelector('.app-shell', { timeout: 10000 });

  // Give the app some time to settle
  await page.waitForTimeout(2000);

  // Check the console trap
  const errors = await page.evaluate(() => {
    const trap = document.getElementById('console-trap');
    const data = trap?.getAttribute('data-errors') || '[]';
    return JSON.parse(data);
  });

  if (errors.length > 0) {
    console.error('Found console errors:', errors);
  }

  expect(errors, `Found console errors: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0);
});
