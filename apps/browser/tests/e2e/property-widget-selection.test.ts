import { expect, test } from '@playwright/test'

test.describe('Property Widget Selection', () => {
	test('Test 1: Single Object Selection', async ({ page }) => {
		page.on('console', (msg) => console.log(`BROWSER: ${msg.text()}`))
		// 1. Navigate to app
		await page.goto('/')
		await page.waitForSelector('.app-shell')
		// Check window.game (single global instance)
		await page
			.waitForFunction(() => !!(window as any).game, { timeout: 10000 })
			.catch(() => console.log('game not found on window'))

		await page.waitForFunction(() => [...((window as any).game?.population || [])].length > 0, {
			timeout: 30000,
		})

		// 2. Select a character using __selectObject (opens follow panel automatically)
		const charUid = await page.evaluate(() => {
			const game = (window as any).game
			const char = [...game.population][0]
			if (!char) return null
			;(window as any).__selectObject?.(char)
			return (window as any).debugObjectId(char)
		})
		expect(charUid).toBeTruthy()

		// 3. Verify widget appears
		const panel = page.locator('.selection-info-panel')
		await expect(panel).toBeVisible()

		// 4. Verify content — use .first() to avoid strict mode if dockview renders a placeholder
		await expect(panel.locator('.character-properties__stats').first()).toBeVisible()

		// 5. Verify panel has correct UID
		await expect(panel).toHaveAttribute('data-test-object-uid', charUid)
	})
})
