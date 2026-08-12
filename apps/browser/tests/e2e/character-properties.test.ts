import { expect, test } from '@playwright/test'

test.describe('Character Properties Display', () => {
	test('should display character properties correctly', async ({ page }) => {
		await page.goto('/')

		// Wait for game to be loaded
		await page.waitForFunction(async () => {
			const game = (window as any).game
			return game?.loaded
		})

		// Select first character using __selectObject helper
		const charUid = await page.evaluate(() => {
			const game = (window as any).game
			const char = [...game.population][0]
			;(window as any).__selectObject?.(char)
			return (window as any).debugObjectId(char)
		})

		// Wait for panel to appear
		const panel = page.locator('.selection-info-panel')
		await expect(panel).toBeVisible()

		// Verify panel shows correct character
		await expect(panel).toHaveAttribute('data-test-object-uid', charUid)

		// Check for stats
		await expect(panel.locator('.character-properties__stats').first()).toBeVisible()
	})
})
