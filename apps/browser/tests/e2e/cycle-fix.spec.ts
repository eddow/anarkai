import { expect, test } from '@playwright/test'

test('no ReactiveError when interactionMode.selectedAction changes', async ({ page }) => {
	// Listen for console errors and fail if a ReactiveError is thrown
	const errors: string[] = []
	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			errors.push(msg.text())
		}
	})
	page.on('pageerror', (err) => {
		errors.push(err.message)
	})

	await page.goto('/')

	// Wait for the app to load
	await page.waitForSelector('.app-shell')

	// Trigger the interactionMode.selectedAction change that previously caused the cycle
	// Click a build button to change selectedAction from '' to 'build:...'
	await page.click('[aria-label="Residential"]')

	// Now click the Select button to change it back to ''
	await page.click('[aria-label="Select"]')

	// Give the app a moment to process any reactive updates
	await page.waitForTimeout(100)

	// Check that no ReactiveError was thrown
	const reactiveErrors = errors.filter(
		(err) => err.includes('ReactiveError') && err.includes('Cycle detected')
	)
	expect(reactiveErrors).toHaveLength(0)
})

test('no ReactiveError when hovering the board', async ({ page }) => {
	const errors: string[] = []
	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			errors.push(msg.text())
		}
	})
	page.on('pageerror', (err) => {
		errors.push(err.message)
	})

	await page.goto('/')
	await page.waitForSelector('.app-shell')
	await page.waitForFunction(() => {
		return typeof (window as any).__ANARKAI_TERRAIN_DIAGNOSTICS__ === 'function'
	})

	const canvas = page.locator('canvas')
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()

	const points = [
		{ x: box!.x + box!.width * 0.5, y: box!.y + box!.height * 0.5 },
		{ x: box!.x + box!.width * 0.65, y: box!.y + box!.height * 0.45 },
		{ x: box!.x + box!.width * 0.35, y: box!.y + box!.height * 0.6 },
		{ x: box!.x + box!.width * 0.55, y: box!.y + box!.height * 0.3 },
	]

	for (const point of points) {
		await page.mouse.move(point.x, point.y)
		await page.waitForTimeout(50)
	}

	await page.waitForTimeout(200)

	const reactiveErrors = errors.filter(
		(err) =>
			err.includes('ReactiveError') &&
			(err.includes('Max effect chain reached') || err.includes('broken after an unrecoverable error'))
	)
	expect(reactiveErrors).toHaveLength(0)
})
