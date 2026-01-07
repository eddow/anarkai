import { test, expect } from '@playwright/test';

test('click on stonecutter builder activates button', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  await page.goto('/');
  
  // Wait for the app to hydrate and reactivity to settle
  await page.waitForTimeout(1000); 

  // Locate the button. Using a flexible selector or the ID provided by user.
  // User said: "whose id is build-alveolus-stonecutter"
  // Assuming the alveolus name is 'stonecutter' (lowercase) or 'StoneCutter'.
  // I'll try to find the button regardless of exact ID casing if possible, but user specified ID.
  // Let's assume the ID exists.
  
  // Note: Depending on data, it might be 'StoneCutter'. 
  // I will use a selector that targets the button structure if ID fails, but let's try ID.
  const button = page.locator('#build-alveolus-StoneCutter').or(page.locator('#build-alveolus-stonecutter'));

  await expect(button).toBeVisible();
  
  // Initial state: not active
  await expect(button).not.toHaveClass(/v-button--active/);

  // Click it
  await button.click();
  
  // Check active state
  // This verifies that the click triggered the action update AND the reactivity system propagated it back to the button class
  await expect(button).toHaveClass(/v-button--active/);
});
