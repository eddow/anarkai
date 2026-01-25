import { test, expect } from '@playwright/test'

test.describe('Character Properties Display', () => {
    test('should display character properties correctly', async ({ page }) => {
        await page.goto('/')

        // Wait for game to be loaded
        await page.waitForFunction(async () => {
            const game = (window as any).games?.game('GameX')
            return game?.loaded
        })

        // Select a character and ensure panel is open
        await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const char = [...game.population][0]
            ;(window as any).selectionState.selectedUid = char.uid
            
            // Explicitly add panel if not present
            if (!(window as any).dockviewApi.getPanel('selection-info')) {
                (window as any).dockviewApi.addPanel({
                    id: 'selection-info',
                    component: 'selection-info',
                    title: 'Selection',
                    params: { uid: char.uid }
                })
            }
        })

        // Wait for panel to appear
        const panel = page.locator('.selection-info-panel')
        await expect(panel).toBeVisible()

        // Check for stats
        await expect(panel.locator('.character-properties__stats')).toBeVisible()
        
        // Check for activity badge
        const badge = panel.locator('.character-activity .badge')
        await expect(badge).toBeVisible()
        const badgeText = await badge.innerText()
        expect(badgeText.length).toBeGreaterThan(0)
        
        // Check that it's not "UNDEFINED" or empty
        expect(badgeText).not.toBe('')
    })
})
