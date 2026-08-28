import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/** Attach a ReactiveError listener and return the collected messages. */
function collectReactiveErrors(page: Page) {
	const errors: string[] = []
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text())
	})
	page.on('pageerror', (err) => {
		errors.push(err.message)
	})
	return errors
}

const reactiveCycleErrors = (errors: string[]) =>
	errors.filter((e) => e.includes('ReactiveError') && e.includes('Cycle detected'))

test.describe('Zone tools', () => {
	test('paint button selects the zone tool instead of the select tool', async ({ page }) => {
		await page.addInitScript(() => window.localStorage.clear())
		await page.goto('/')
		await page.waitForFunction(() => !!(window as any).game?.loaded, { timeout: 30000 })

		await page.evaluate(async () => {
			const game = (window as any).game
			await game.loaded
			const zone = game.hex.zoneManager.resolveZone('residential')
			;(window as any).showZoneObject?.(zone)
		})

		const panel = page.locator('.selection-info-panel')
		await expect(panel).toBeVisible()
		const paint = panel.locator('[data-testid="zone-paint"]')
		await expect(paint).toBeVisible()

		// Selection tool is active by default (selectedAction === ''), so the
		// typed zone's paint button must NOT be shown as pressed.
		await expect(paint).toHaveAttribute('aria-pressed', 'false')

		// Clicking "add to this zone" must select the zone:residential tool.
		await paint.click()
		await expect(paint).toHaveAttribute('aria-pressed', 'true')

		const selectedAction = await page.evaluate(
			() => (window as any).interactionMode?.selectedAction
		)
		expect(selectedAction).toBe('zone:residential')
	})

	test('delete zone closes the widget and removes the zone without a cycle', async ({ page }) => {
		await page.addInitScript(() => window.localStorage.clear())
		await page.goto('/')
		const errors = collectReactiveErrors(page)
		await page.waitForFunction(() => !!(window as any).game?.loaded, { timeout: 30000 })

		// Reproduce the real UI flow: open the Zones list, create a zone, then
		// delete it. "New zone" also arms `interactionMode.selectedAction` and
		// `unnamedZoneOwnership.zone`, which is what the delete handler must undo.
		await page.evaluate(async () => {
			const game = (window as any).game
			await game.loaded
			;(window as any).showZonesObject?.()
		})

		const zonesPanel = page.locator('.selection-info-panel')
		await expect(zonesPanel).toBeVisible()
		await zonesPanel.locator('[data-testid="zones-create"]').click()

		// The panel now shows the freshly-created zone's properties.
		const panel = page.locator('.selection-info-panel')
		await expect(panel.locator('[data-testid="zone-name"]')).toBeVisible()

		const zoneName = await panel.locator('[data-testid="zone-name"]').inputValue()

		// Paint tiles onto the zone. The per-tile `tile.*.interaction` effects
		// read `effectiveZone` + `selectedAction`, so deleting a zone with live
		// tile membership is what previously formed the reactive effect cycle.
		await page.evaluate(async (name) => {
			const game = (window as any).game
			await game.loaded
			const zone = game.hex.zoneManager
				.listCustomZoneDefinitions()
				.find((z: any) => z.name === name)
			if (!zone) throw new Error('zone not found')
			for (const coord of [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 0, r: 1 },
				{ q: -1, r: 1 },
				{ q: 1, r: -1 },
				{ q: -1, r: 0 },
				{ q: 0, r: -1 },
			]) {
				game.hex.zoneManager.setZone(coord, zone)
			}
		}, zoneName)

		await panel.locator('[data-testid="zone-delete"]').click()
		await expect(panel.locator('[data-testid="zone-delete-confirm"]')).toBeVisible()
		await panel.locator('[data-testid="zone-delete-confirm"]').click()

		// The zone definition must be gone.
		await expect
			.poll(async () =>
				page.evaluate((name) => {
					const game = (window as any).game
					return game.hex.zoneManager.listZoneDefinitions().some((z: any) => z.name === name)
				}, zoneName)
			)
			.toBe(false)

		// The painted tiles must be unzoned (the spatial assignments were cleared).
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const game = (window as any).game
					return [
						{ q: 0, r: 0 },
						{ q: 1, r: 0 },
						{ q: 0, r: 1 },
						{ q: -1, r: 1 },
						{ q: 1, r: -1 },
						{ q: -1, r: 0 },
						{ q: 0, r: -1 },
					].every((coord) => game.hex.zoneManager.getZone(coord) === undefined)
				})
			)
			.toBe(true)

		// No ReactiveError cycle may have been thrown during deletion.
		expect(reactiveCycleErrors(errors)).toHaveLength(0)

		// The property widget must detach from the deleted zone (panel closed).
		await expect(page.locator('.selection-info-panel')).toHaveCount(0)
	})
})
