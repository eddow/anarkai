import { expect, test } from '@playwright/test'

test.describe('Linked Entity Navigation', () => {
	test('opens a follow inspector from a pinned character panel without retargeting the pinned panel', async ({
		page,
	}) => {
		await page.goto('/')

		await page.waitForFunction(async () => {
			const game = (window as any).game
			if (!game) return false
			await game.loaded
			return [...game.population].length > 0
		})

		const context = await page.evaluate(() => {
			const game = (window as any).game
			const char = [...game.population][0]
			const targetTile = game.hex.getTile({ q: 0, r: 0 }) ?? [...game.hex.tiles][0]
			char.lastWorkPlannerSnapshot = {
				ranked: [
					{
						jobKind: 'gather',
						targetLabel: `Tile ${targetTile.position.q}, ${targetTile.position.r}`,
						targetCoord: {
							q: targetTile.position.q,
							r: targetTile.position.r,
						},
						urgency: 4,
						pathLength: 1,
						score: 2,
						selected: true,
					},
				],
			}

			;(window as any).dockviewApi.addPanel({
				id: 'selection-info-pinned',
				component: 'selection-info',
				title: 'Selection',
				params: { uid: char.uid },
			})

			return {
				charUid: char.uid,
				tileUid: targetTile.uid,
			}
		})

		const pinnedPanel = page.locator(
			`.selection-info-panel[data-test-object-uid="${context.charUid}"]`
		)
		await expect(pinnedPanel).toBeVisible()

		const link = pinnedPanel.locator('[data-testid="linked-entity-control"]')
		await expect(link).toBeVisible()

		await link.hover()
		await expect
			.poll(async () => page.evaluate(() => (window as any).mrg.hoveredObject?.uid))
			.toBe(context.tileUid)

		await link.click()

		await expect(pinnedPanel).toHaveAttribute('data-test-object-uid', context.charUid)
		const tilePanel = page.locator(
			`.selection-info-panel[data-test-object-uid="${context.tileUid}"]`
		)
		await expect(tilePanel).toBeVisible()
	})
})
