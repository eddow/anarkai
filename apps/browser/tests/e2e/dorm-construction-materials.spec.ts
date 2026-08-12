import { expect, test } from '@playwright/test'

test('selecting a tile opens the selection-info panel', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.clear()
	})

	await page.goto('/')
	await page.waitForSelector('.app-shell', { timeout: 10000 })
	await page.waitForSelector('.dockview-widget--game', { timeout: 10000 })

	const clickedSite = await page.evaluate(async () => {
		const game = (window as any).game
		if (!game) throw new Error('Missing window.game')
		await game.loaded
		game.ticker?.stop?.()

		// Select any tile
		const tile = game.hex.getTile({ q: 0, r: -1 }) || [...game.hex.tiles][0]
		if (!tile) throw new Error('No tile found')

		;(window as any).__selectObject?.(tile)
		return { tileUid: (window as any).debugObjectId(tile) }
	})

	await page.waitForTimeout(300)

	const panel = page.locator(`.selection-info-panel[data-test-object-uid="${clickedSite.tileUid}"]`)
	await expect(panel).toBeVisible({ timeout: 5000 })
})
