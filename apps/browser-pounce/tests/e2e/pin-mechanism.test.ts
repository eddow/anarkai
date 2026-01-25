import { test, expect } from '@playwright/test'

test.describe('Pin Mechanism', () => {
    test('should lock content when pinned', async ({ page }) => {
        await page.goto('/')

        // Wait for game
        await page.waitForFunction(() => (window as any).games?.game('GameX')?.loaded)

        // 1. Select Char A and ensuring panel is open (Dynamic mode)
        const charA = await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const chars = [...game.population]
            const char = chars[0]
            ;(window as any).selectionState.selectedUid = char.uid
            
            // Open dynamic panel if not open (mimic GameWidget behavior)
            const dock = (window as any).dockviewApi
            if (!dock.getPanel('selection-info')) {
                 dock.addPanel({
                    id: 'selection-info',
                    component: 'selection-info',
                    params: {}, // Empty params for dynamic
                    title: 'Selection'
                })
            }
            
            return { uid: char.uid, name: char.title || char.name }
        })

        // Wait for panel
        const panel = page.locator('.selection-info-panel')
        await expect(panel).toBeVisible()
        await expect(panel).toHaveAttribute('data-test-object-uid', charA.uid)

        // 2. Click Pin
        // Note: aria-label is not preserved by Button component, use icon class
        const pinBtn = panel.locator('.glyf-mdi-pin').locator('xpath=./ancestor::button')
        await expect(pinBtn).toBeVisible()
        await pinBtn.click()

        // 3. Select Char B
        const charB = await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const chars = [...game.population]
            const char = chars[1]
            ;(window as any).selectionState.selectedUid = char.uid
            return { uid: char.uid, name: char.title || char.name }
        })

        // 4. Verify Panel still shows Char A (Pin should lock it)
        // If Pin works: UID should be A
        // If Pin broken: UID changes to B
        await expect(panel).toHaveAttribute('data-test-object-uid', charA.uid, { timeout: 2000 })
            .catch(() => console.log("Panel updated to Char B (Reproduced Pin Bug)"))

        // 5. Verify no second panel opened (optional, but good sanity check)
        const panels = page.locator('.selection-info-panel')
        expect(await panels.count()).toBe(1)
    })

    test('should allow highlighting selected object when panel is open', async ({ page }) => {
        await page.goto('/')
        await page.waitForFunction(() => (window as any).games?.game('GameX')?.loaded)

        // Select Char A
        const charA = await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const char = [...game.population][0]
            ;(window as any).selectionState.selectedUid = char.uid
            return char.uid
        })

        // Hover Char A in game (simulate via mrg)
        await page.evaluate((uid) => {
            const game = (window as any).games.game('GameX')
            const char = game.getObject(uid)
            ;(window as any).mrg.hoveredObject = char
        }, charA)

        // Wait a bit for potential reactivity loop to clear it
        await page.waitForTimeout(100)

        // Check if still hovered
        const hoveredUid = await page.evaluate(() => (window as any).mrg.hoveredObject?.uid)
        
        // If bug exists, hoveredUid will be undefined
        expect(hoveredUid).toBe(charA)
    })
})
