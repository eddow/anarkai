import { test, expect } from '@playwright/test';

test('hovering over tiles does not crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
      // console.log('BROWSER LOG:', msg.text());
  });
  page.on('pageerror', err => {
      errors.push(err.message);
      console.log('PAGE ERROR:', err.message);
  });

  await page.goto('/');
  await page.waitForTimeout(3000); // Wait for game load

  // Locate the game canvas
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();

  // Move mouse across the canvas in a grid pattern to trigger many hover updates
  const box = await canvas.boundingBox();
  if (box) {
      // Simulate rapid movement
      for (let i = 0; i < 20; i++) {
          const x = box.x + Math.random() * box.width;
          const y = box.y + Math.random() * box.height;
          await page.mouse.move(x, y);
          await page.waitForTimeout(10);
      }
  }
  
  // Check for "Max effect chain" in errors specifically
  const crashErrors = errors.filter(e => e.includes('Max effect chain') || e.includes('ReactiveError') || e.includes('Maximum call stack'));
  expect(crashErrors).toHaveLength(0);
});
