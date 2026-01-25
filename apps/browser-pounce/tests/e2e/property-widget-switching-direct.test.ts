import { test, expect } from '@playwright/test'

test.describe('Property Widget Switching Direct', () => {
    test('should update widget when switching directly between characters', async ({ page }) => {
        await page.goto('/')

        // Wait for game to be loaded
        await page.waitForFunction(async () => {
            const game = (window as any).games?.game('GameX')
            if (!game) return false
            await game.loaded
            return !!game.hex
        })

        // Find two characters
        const objects = await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const characters = [...game.population]
            return {
                charA: { uid: characters[0].uid },
                charB: { uid: characters[1].uid }
            }
        })

        const { charA, charB } = objects

        const selectAndVerify = async (id: string) => {
             // Trigger selection via game.clickObject
             await page.evaluate((uid) => {
                 const game = (window as any).games.game('GameX')
                 const obj = game.getObject(uid)
                 game.clickObject({ button: 0 }, obj)
             }, id)

             // Give it a moment to update
             await page.waitForTimeout(300)

             const panel = page.locator('.selection-info-panel')
             await expect(panel).toBeVisible()
             
             // Check if the widget has the correct UID
             await expect(panel).toHaveAttribute('data-test-object-uid', id)
        }

        // 1. Click Char A
        await selectAndVerify(charA.uid)
        
        // 2. DIRECT SWITCH: Click Char B directly after Char A
        await selectAndVerify(charB.uid)
        
        // 3. DIRECT SWITCH BACK: Click Char A directly after Char B
        await selectAndVerify(charA.uid)
    })
})
