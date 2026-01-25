import { expect, test } from '@playwright/test'

test.describe('Property Widget Switching', () => {
	test('Test 2: Switching Selection', async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`))
		await page.goto('/')
		await page.waitForSelector('.app-shell')
        
        // Wait for population > 1 (need at least 2 chars)
        await page.waitForFunction(() => [...(window as any).games?.game('GameX')?.population || []].length >= 2, { timeout: 30000 })

        // Get two character UIDs
        const [charA, charB] = await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const chars = [...game.population]
            return [chars[0].uid, chars[1].uid]
        })
        expect(charA).toBeTruthy()
        expect(charB).toBeTruthy()
        expect(charA).not.toBe(charB)

        // Open panel in "follow mode" (no params.uid)
        await page.evaluate(() => {
            const api = (window as any).dockviewApi
            api.addPanel({
                id: 'selection-info',
                component: 'selection-info',
                title: 'Selection Info',
                params: {}, // Empty params to rely on selectionState
                floating: { width: 300, height: 500 }
            })
        })

        // 1. Select A
        await page.evaluate((uid) => {
            (window as any).selectionState.selectedUid = uid
        }, charA)

        // Verify A is shown (check data-test-owner-uid)
        const logsA = page.locator('.selection-info-panel__logs')
        // Logs might be empty if object just created? 
        // But the attribute data-test-owner-uid is on the logs container which is rendered if logs.length > 0??
        // Wait, logic in widgets/selection-info.tsx:
        // <div if={state.logs.length > 0} ... data-test-owner-uid={...}>
        // If logs are empty, this div is NOT rendered.
        // We need a reliable element that has the UID.
        // CharacterProperties doesn't seem to expose UID in DOM.
        // The summary view (else block of CharacterProperties) shows "ID: ...".
        
        // But CharacterProperties is rendered for Character.
        // Let's look for something unique to the character in CharacterProperties.
        // Title/Name?
        // We can check if "Selection Info" title changes?
        // The title is set via `scope.setTitle`.
        // Character names are "Character" usually?
        // Let's modify CharacterProperties or something to expose UID for testing?
        // Or rely on `data-test-owner-uid` on the logs container.
        // Do characters have logs initially? "Created"?
        // If they have logs, the container exists.
        
        // Let's assume they have logs (creation log).
        await expect(logsA).toHaveAttribute('data-test-owner-uid', charA, { timeout: 5000 })

        // 2. Select B
        await page.evaluate((uid) => {
            (window as any).selectionState.selectedUid = uid
        }, charB)

        // Verify B is shown
        const logsB = page.locator('.selection-info-panel__logs')
        await expect(logsB).toHaveAttribute('data-test-owner-uid', charB, { timeout: 5000 })
	})
})
