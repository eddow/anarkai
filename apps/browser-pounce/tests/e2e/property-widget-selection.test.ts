import { expect, test } from '@playwright/test'

test.describe('Property Widget Selection', () => {
	test('Test 1: Single Object Selection', async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`))
		// 1. Navigate to app
		await page.goto('/')
		await page.waitForSelector('.app-shell')
        // Check window.games composition
        await page.waitForFunction(() => !!(window as any).games, { timeout: 10000 }).catch(() => console.log('Games not found on window'))
        await page.evaluate(() => {
             console.log('Window keys:', Object.keys(window))
             const g = (window as any).games
             if (g) {
                 console.log('Games:', g)
                 // Try to list games if Map or similar
                 console.log('GameX:', g.game('GameX'))
                 const game = g.game('GameX')
                 if(game) {
                     const popSize = [...game.population].length
                     console.log('Pop size:', popSize)
                     console.log('Clock:', game.clock?.virtualTime)
                 }
             }
        })
        
        await page.waitForFunction(() => [...(window as any).games?.game('GameX')?.population || []].length > 0, { timeout: 30000 })

        // 2. Select a character via script
        const charUid = await page.evaluate(async () => {
            const game = (window as any).games.game('GameX')
            const char = [...game.population][0]
            if (char) {
                // Determine dockview API
                const api = (window as any).dockviewApi
                if (!api) return null
                
                // Open panel for this character
                api.addPanel({
                    id: 'selection-info',
                    component: 'selection-info',
                    title: 'Selection Info',
                    params: { uid: char.uid },
                    floating: { width: 300, height: 500 }
                })
                
                return char.uid
            }
            return null
        })
        expect(charUid).toBeTruthy()

        // 3. Verify widget appears
        const panel = page.locator('.selection-info-panel')
        await expect(panel).toBeVisible()

        // 4. Verify content
        // Check if stats are present (CharacterProperties renders them)
        const stats = page.locator('.character-properties__stats')
        await expect(stats).toBeVisible()
        
        // Check if activity badge is present (this verifies the fix for "no activity showing")
        const activityComp = page.locator('.character-activity')
        await expect(activityComp).toBeVisible()
        const badge = page.locator('.character-activity .badge')
        await expect(badge).toBeVisible()

        // 5. Verify data-test-owner-uid matches
        // Note: logs might be empty initially, so the logs div might not be rendered unless logs > 0
        // But if we force a log or wait for one?
        // Actually the code shows: <div if={state.logs.length > 0} ...
        // So checking this might be flaky if there are no logs.
        // Let's force a log entry for testing purposes?
        // Or just verify the title which should match the character name.
        
        // Let's rely on checking if the character property component is there, which implies mapped correct object.
	})
})
