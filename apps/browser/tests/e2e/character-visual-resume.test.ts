import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

type VisualSnapshot = {
	charUid: string
	charPosition: { q?: number; r?: number; x?: number; y?: number }
	visualPosition: { x: number; y: number }
}

function shiftedPosition(position: VisualSnapshot['charPosition']) {
	if (typeof position.q === 'number' && typeof position.r === 'number') {
		return { q: position.q + 0.35, r: position.r }
	}
	if (typeof position.x === 'number' && typeof position.y === 'number') {
		return { x: position.x + 24, y: position.y }
	}
	throw new Error(`Unsupported test position: ${JSON.stringify(position)}`)
}

async function snapshotSelectedCharacter(page: Page) {
	return page.evaluate((): VisualSnapshot => {
		const game = (window as any).game
		const selectedObject = (window as any).selectionState.selectedObject
		const visual = [...(game.renderer?.visuals?.values?.() ?? [])].find(
			(v: any) => v?.object === selectedObject
		)
		const char = visual?.object
		if (!visual || !char) throw new Error('Missing Pixi visual for selected character')
		return {
			charUid: (window as any).debugObjectId(char),
			charPosition: { ...char.position },
			visualPosition: {
				x: visual.view.position.x,
				y: visual.view.position.y,
			},
		}
	})
}

test.describe('Character board visual after inspector resume', () => {
	test('keeps the Pixi character visual bound after opening properties while paused', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			window.localStorage.clear()
		})
		await page.goto('/')

		// Wait for Pixi visuals to be rendered (may take longer with terrain baking)
		await expect
			.poll(
				async () =>
					page.evaluate(() => {
						const game = (window as any).game
						return [...(game?.renderer?.visuals?.values?.() ?? [])].filter(
							(visual: any) =>
								typeof visual?.view?.label === 'string' &&
								visual.view.label.startsWith('character:')
						).length
					}),
				{ timeout: 30000, intervals: [500, 1000, 2000, 5000] }
			)
			.toBeGreaterThan(0)

		const selected = await page.evaluate(() => {
			const game = (window as any).game
			const charVisual = [...game.renderer.visuals.values()].find(
				(visual: any) =>
					typeof visual?.view?.label === 'string' && visual.view.label.startsWith('character:')
			)
			const char = charVisual?.object
			if (!char) throw new Error('Missing rendered character')
			;(window as any).configuration.timeControl = 0
			;(window as any).__selectObject?.(char)
			return { uid: (window as any).debugObjectId(char) }
		})

		await page.waitForTimeout(300)

		const panel = page.locator(`.selection-info-panel[data-test-object-uid="${selected.uid}"]`)
		await expect(panel).toBeVisible()
		await expect(panel.locator('.character-properties')).toBeVisible()

		const before = await snapshotSelectedCharacter(page)
		await page.evaluate((nextPosition) => {
			const char = (window as any).selectionState.selectedObject
			const step = char.scriptsContext.walk.moveTo(nextPosition)
			if (!step) throw new Error('Expected a movement step')
			char.stepExecutor?.cancel()
			for (const script of char.runningScripts) script.cancel(char.scriptsContext)
			char.runningScripts.splice(0, char.runningScripts.length)
			char.stepExecutor = step
			;(window as any).configuration.timeControl = 1
			char.update(0.2)
		}, shiftedPosition(before.charPosition))

		await expect
			.poll(async () => {
				const after = await snapshotSelectedCharacter(page)
				return {
					charMoved: JSON.stringify(after.charPosition) !== JSON.stringify(before.charPosition),
					visualMoved:
						after.visualPosition.x !== before.visualPosition.x ||
						after.visualPosition.y !== before.visualPosition.y,
				}
			})
			.toEqual({ charMoved: true, visualMoved: true })
	})
})
