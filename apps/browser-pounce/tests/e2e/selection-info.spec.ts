import { test, expect } from '@playwright/test';

test('selection info title update', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');

  // Wait for the app to load
  await page.waitForSelector('.app-shell', { timeout: 10000 });
  await page.waitForTimeout(2000);

  page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

  // Open the selection-info panel directly using the exposed API
  // This bypasses the need to select a game object which proved flaky
  const result = await page.evaluate(async () => {
      // @ts-ignore
      const api = window.dockviewApi;
      if (!api) return false;
      
      api.addPanel({
          id: 'test-selection-panel',
          component: 'selection-info',
          title: 'Initial Title',
          params: { uid: 'dummy-uid' } // Pass dummy UID to satisfy props
      });
      return true;
  });
  
  if (!result) {
      console.log('Failed to access dockviewApi');
      // Fail test if API not available
      expect(result).toBe(true); 
  }

  // Check if panel exists in DOM
  const panel = page.locator('.selection-info-panel');
  await expect(panel).toBeVisible({ timeout: 5000 });

  // Verify title update is automatic
  // It should be 'Selection', or character name, or Tile coordinates.
  // We've seen 'Tile -1, 2' in the browser subagent inspection.
  // getByText matcher with regex should work.
  await expect(page.locator('.dv-tab-content').getByText(/Selection|Tile|Object|Character/)).toBeVisible({ timeout: 5000 });
});
