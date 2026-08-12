import { expect, test } from '@playwright/test'

test.describe('Property Widget Switching Direct', () => {
	test('should update widget when switching directly between characters', async ({ page }) => {
		await page.goto('/')

		// Wait for game to be loaded
		await page.waitForFunction(async () => {
			const game = (window as any).game
			if (!game) return false
			await game.loaded
			return !!game.hex
		})

		const selectByIndex = async (index: number) => {
			const uid = await page.evaluate((idx) => {
				const game = (window as any).game
				const char = [...game.population][idx]
				if (!char) throw new Error(`No character at index ${idx}`)
				;(window as any).__selectObject?.(char)
				return (window as any).debugObjectId(char)
			}, index)

			// Wait for reactive update to propagate to DOM
			await page.waitForTimeout(300)

			const panel = page.locator('.selection-info-panel')
			await expect(panel).toBeVisible()
			await expect(panel).toHaveAttribute('data-test-object-uid', uid)
		}

		// 1. Click Char A
		await selectByIndex(0)

		// 2. DIRECT SWITCH: Click Char B directly after Char A
		await selectByIndex(1)

		// 3. DIRECT SWITCH BACK: Click Char A directly after Char B
		await selectByIndex(0)
	})
})
