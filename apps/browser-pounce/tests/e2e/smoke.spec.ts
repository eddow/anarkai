import { test, expect } from '@playwright/test';

test('no console errors or warnings', async ({ page }) => {
  // Set up console logging before navigation
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Also capture page errors with full stack
  const pageErrors: any[] = [];
  page.on('pageerror', error => {
    pageErrors.push({
      message: error.message,
      stack: error.stack,
      name: error.name
    });
  });

  // Navigate to the app
  await page.goto('/');

  // Wait a bit for any initial errors
  await page.waitForTimeout(10000);

  // Try to check the console trap even if app didn't render
  const errors = await page.evaluate(() => {
    const trap = document.getElementById('console-trap');
    const data = trap?.getAttribute('data-errors') || '[]';
    return JSON.parse(data);
  });

  // Log all console messages we captured
  console.log('Console logs:', consoleLogs);
  console.log('Page errors:', pageErrors);
  console.log('Console trap errors:', errors);

  // Check if there are any errors in the console trap
  if (errors.length > 0) {
    console.log('Console trap error details:', JSON.stringify(errors, null, 2));
  }
  
  // Also check for page errors
  if (pageErrors.length > 0) {
    console.log('Page error details:', JSON.stringify(pageErrors, null, 2));
  }

  expect(errors, `Found console errors: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0);
  expect(pageErrors, `Found page errors: ${JSON.stringify(pageErrors, null, 2)}`).toHaveLength(0);
});
