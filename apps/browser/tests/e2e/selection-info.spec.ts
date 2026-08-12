import { expect, test } from '@playwright/test'

test('selection info title update', async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('.app-shell', { timeout: 10000 })
	await page.waitForTimeout(2000)

	// Select first character using __selectObject
	await page.evaluate(async () => {
		const game = (window as any).game
		await game.loaded
		const char = [...game.population][0]
		if (char) {
			;(window as any).__selectObject?.(char)
		}
	})
	await page.waitForTimeout(300)

	// Check panel exists
	const panel = page.locator('.selection-info-panel')
	await expect(panel).toBeVisible({ timeout: 5000 })

	// Panel should have a non-empty data-test-object-uid (not "null")
	const uid = await panel.getAttribute('data-test-object-uid')
	expect(uid).toBeTruthy()
	expect(uid).not.toBe('null')
})
