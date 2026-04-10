import { expect, test } from '@playwright/test'

test('pixi terrain baker initializes and survives terrain invalidation', async ({ page }) => {
	const pageErrors: Array<{ message: string; stack?: string }> = []
	const consoleErrors: string[] = []
	const consoleWarnings: string[] = []

	page.on('pageerror', (error) => {
		pageErrors.push({ message: error.message, stack: error.stack })
	})
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text())
		if (msg.type() === 'warning' || msg.type() === 'warn') consoleWarnings.push(msg.text())
	})

	await page.goto('/')

	await page.waitForFunction(() => {
		return typeof (window as any).__ANARKAI_TERRAIN_DIAGNOSTICS__ === 'function' && !!(window as any).game
	})

	const initialDiagnostics = await page.evaluate(async () => {
		const game = (window as any).game
		await game.loaded
		for (let i = 0; i < 20; i++) {
			const diagnostics = (window as any).__ANARKAI_TERRAIN_DIAGNOSTICS__?.()
			if (diagnostics?.refresh?.visibleSectorCount || diagnostics?.totals?.sectorsRendered) {
				return diagnostics
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		return (window as any).__ANARKAI_TERRAIN_DIAGNOSTICS__?.()
	})
	expect(initialDiagnostics).toBeTruthy()
	expect(initialDiagnostics?.refresh?.visibleSectorCount ?? 0).toBeGreaterThan(0)

	await page.evaluate(async () => {
		const game = (window as any).game
		await game.loaded
		game.upsertTerrainOverride({ q: 0, r: 0 }, { terrain: 'concrete' })
	})

	await page.waitForTimeout(1500)

	const updatedDiagnostics = await page.evaluate(() => (window as any).__ANARKAI_TERRAIN_DIAGNOSTICS__?.())
	expect(updatedDiagnostics).toBeTruthy()
	expect(updatedDiagnostics?.totals?.sectorsRendered ?? 0).toBeGreaterThan(0)

	const terrainErrors = [...consoleErrors, ...pageErrors.map((error) => error.message)].filter(
		(message) =>
			message.includes('SectorTerrainBaker') ||
			message.includes('UniformGroup') ||
			message.includes('PixiGameRenderer') ||
			message.includes('terrain-sector-baker')
	)
	const terrainWarnings = consoleWarnings.filter(
		(message) =>
			message.includes('Attribute aBarycentric is not present in the shader') ||
			message.includes('Attribute aPosition is not present in the shader') ||
			message.includes('Attribute aUV is not present in the shader')
	)

	expect(
		terrainErrors,
		`Unexpected terrain bake errors:\n${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`
	).toHaveLength(0)
	expect(
		terrainWarnings,
		`Unexpected terrain bake warnings:\n${JSON.stringify({ consoleWarnings }, null, 2)}`
	).toHaveLength(0)
})
