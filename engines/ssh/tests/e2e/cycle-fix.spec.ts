import { test, expect } from '@playwright/test';

test('no ReactiveError when interactionMode.selectedAction changes', async ({ page }) => {
  // Listen for console errors and fail if a ReactiveError is thrown
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });

  await page.goto('/');

  // Wait for the app to load
  await page.waitForSelector('.app-shell');

  // Trigger the interactionMode.selectedAction change that previously caused the cycle
  // Click a build button to change selectedAction from '' to 'build:...'
  await page.click('[aria-label="Build residential"]');

  // Now click the Select button to change it back to ''
  await page.click('[aria-label="Select"]');

  // Give the app a moment to process any reactive updates
  await page.waitForTimeout(100);

  // Check that no ReactiveError was thrown
  const reactiveErrors = errors.filter(err => err.includes('ReactiveError') && err.includes('Cycle detected'));
  expect(reactiveErrors).toHaveLength(0);
});
