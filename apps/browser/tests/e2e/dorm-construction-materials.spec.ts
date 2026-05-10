import { expect, test } from '@playwright/test'

test('dorm woodchopper construction site shows its needed material count', async ({ page }) => {
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

		const tile = game.hex.getTile({ q: 0, r: -1 })
		if (!tile) throw new Error('Missing dorm construction tile at 0,-1')

		const requiredGoods = { ...(tile.content?.requiredGoods ?? {}) }
		game.simulateObjectClick(tile, { button: 0 })

		return {
			tileUid: tile.uid,
			requiredGoods,
		}
	})

	expect(clickedSite.requiredGoods).toEqual({ stone: 2 })

	const panel = page.locator(
		`.selection-info-panel[data-test-object-uid="${clickedSite.tileUid}"]`
	)
	await expect(panel).toBeVisible({ timeout: 5000 })

	const materials = panel.locator('fieldset.stored-goods-fieldset').filter({
		hasText: 'Materials',
	})
	await expect(materials).toBeVisible()
	await expect(materials.locator('[aria-label="stone"]')).toBeVisible()
	await expect(materials.getByText('0/2')).toBeVisible()
})
