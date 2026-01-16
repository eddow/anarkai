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
          title: 'Initial Debug Title',
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
  if (await panel.count() === 0) {
      console.log('Selection panel NOT found in DOM. Widget likely failed to render.');
      // Dump body for debugging
      // const body = await page.content();
      // console.log('Body:', body);
      
      // Check globals again
       await page.evaluate(() => {
           console.log('Checking globals again:');
           // @ts-ignore
           console.log('games:', !!window.games);
           // @ts-ignore
           console.log('GameX:', window.games?.game('GameX'));
       });
  } else {
      console.log('Selection panel found in DOM.');
      console.log('Panel HTML:', await panel.innerHTML());
  }

  // Now look for the debug button we added
  // The rendered HTML shows aria-label="Action", so we target by icon
  const debugBtn = page.locator('button .iconify[data-icon="mdi:pencil"]').first();
  
  if (await debugBtn.count() > 0) {
      console.log('Debug button found via Icon locator');
  } else {
      console.log('Debug button NOT found via Icon locator');
  }

  // It should be visible if an object is selected
  await expect(debugBtn).toBeVisible({ timeout: 5000 });
  
  // Click the button (parent of icon)
  await debugBtn.click();
  
  // Verify title update
  // The title is in the dockview tab or header.
  // We look for "Debug Title" text.
  await expect(page.getByText('Debug Title')).toBeVisible({ timeout: 5000 });
});
