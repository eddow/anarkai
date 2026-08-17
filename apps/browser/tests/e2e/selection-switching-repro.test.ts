import { expect, test } from '@playwright/test'

test.describe('Property Widget Selection Switching Repro', () => {
	test('should update widget when switching between characters', async ({ page }) => {
		await page.goto('/')
		await page.waitForFunction(async () => {
			const game = (window as any).game
			if (!game) return false
			await game.loaded
			return !!game.hex
		})

		const selectByIndex = async (collection: 'population' | 'vehicles', index: number) => {
			const uid = await page.evaluate(
				({ collection, index }) => {
					const game = (window as any).game
					const obj = [...game[collection]][index]
					if (!obj) throw new Error(`No object at ${collection}[${index}]`)
					;(window as any).__selectObject?.(obj)
					return (window as any).debugObjectId(obj)
				},
				{ collection, index }
			)
			await page.waitForTimeout(300)
			const panel = page.locator('.selection-info-panel')
			await expect(panel).toBeVisible()
			await expect(panel).toHaveAttribute('data-test-object-uid', uid)
		}

		const selectTile = async (q: number, r: number) => {
			const uid = await page.evaluate(
				({ q, r }) => {
					const game = (window as any).game
					const tile = game.hex.getTile({ q, r })
					if (!tile) throw new Error(`No tile at ${q},${r}`)
					;(window as any).__selectObject?.(tile)
					return (window as any).debugObjectId(tile)
				},
				{ q, r }
			)
			await page.waitForTimeout(300)
			const panel = page.locator('.selection-info-panel')
			await expect(panel).toBeVisible()
			await expect(panel).toHaveAttribute('data-test-object-uid', uid)
		}

		await selectByIndex('population', 0)
		await selectTile(-11, 0)
		await selectByIndex('population', 1)
		await selectTile(-11, 0)
		await selectByIndex('population', 0)
		await selectByIndex('population', 1)
		await selectByIndex('population', 0)
	})

	test('should not keep vehicle properties after switching through an empty tile to a character', async ({
		page,
	}) => {
		await page.goto('/')
		await page.waitForFunction(async () => {
			const game = (window as any).game
			if (!game) return false
			await game.loaded
			return !!game.hex && [...game.population].length > 0 && [...game.vehicles].length > 0
		})

		const select = async (collection: 'population' | 'vehicles', index: number) => {
			const uid = await page.evaluate(
				({ collection, index }) => {
					const game = (window as any).game
					const obj = [...game[collection]][index]
					if (!obj) throw new Error(`No object at ${collection}[${index}]`)
					;(window as any).__selectObject?.(obj)
					return (window as any).debugObjectId(obj)
				},
				{ collection, index }
			)
			await page.waitForTimeout(300)
			await expect(page.locator('.selection-info-panel')).toHaveAttribute(
				'data-test-object-uid',
				uid
			)
		}

		const selectTile = async (q: number, r: number) => {
			const uid = await page.evaluate(
				({ q, r }) => {
					const game = (window as any).game
					const tile = game.hex.getTile({ q, r }) || [...game.hex.tiles][0]
					if (!tile) throw new Error('No tile found')
					;(window as any).__selectObject?.(tile)
					return (window as any).debugObjectId(tile)
				},
				{ q, r }
			)
			await page.waitForTimeout(300)
			await expect(page.locator('.selection-info-panel')).toHaveAttribute(
				'data-test-object-uid',
				uid
			)
		}

		await select('vehicles', 0)
		await expect(page.locator('.vehicle-properties')).toBeVisible()
		await selectTile(-11, 0)
		await expect(page.locator('[data-selection-properties-kind="tile"]')).toHaveCount(1)
		await select('population', 0)
		await expect(page.locator('[data-selection-properties-kind="character"]')).toBeVisible()
		await expect(page.locator('.character-properties')).toBeVisible()
		await expect(page.locator('.vehicle-properties')).toHaveCount(0)
	})
})
