import { expect, test } from '@playwright/test'

test.describe('Property Widget Switching', () => {
	test('Test 2: Switching Selection', async ({ page }) => {
		page.on('console', (msg) => console.log(`BROWSER: ${msg.text()}`))
		await page.goto('/')
		await page.waitForSelector('.app-shell')

		// Wait for population > 1 (need at least 2 chars)
		await page.waitForFunction(() => [...((window as any).game?.population || [])].length >= 2, {
			timeout: 30000,
		})

		// Get two character UIDs
		const [charA, charB] = await page.evaluate(() => {
			const game = (window as any).game
			const chars = [...game.population]
			return [(window as any).debugObjectId(chars[0]), (window as any).debugObjectId(chars[1])]
		})
		expect(charA).toBeTruthy()
		expect(charB).toBeTruthy()
		expect(charA).not.toBe(charB)

		// Open panel in "follow mode" via __selectObject (sets both selectedUid +
		// selectedObject and opens/updates the follow-selection panel)
		await page.evaluate(() => {
			const game = (window as any).game
			const char = [...game.population][0]
			;(window as any).__selectObject?.(char)
		})
		await page.waitForTimeout(300)

		// Verify A's panel is visible with correct UID
		const panel = page.locator('.selection-info-panel')
		await expect(panel).toBeVisible()
		await expect(panel).toHaveAttribute('data-test-object-uid', charA)

		// 2. Select B via __selectObject
		await page.evaluate(() => {
			const game = (window as any).game
			const char = [...game.population][1]
			;(window as any).__selectObject?.(char)
		})
		await page.waitForTimeout(300)

		// Verify B is shown (panel UID updated)
		await expect(panel).toHaveAttribute('data-test-object-uid', charB, {
			timeout: 5000,
		})
	})
})
