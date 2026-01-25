import { test, expect } from '@playwright/test'

test.describe('Property Widget Selection Switching Repro', () => {
    test('should update widget when switching between characters', async ({ page }) => {
        await page.goto('/')

        // Wait for game to be loaded
        await page.waitForFunction(async () => {
            const game = (window as any).games?.game('GameX')
            if (!game) return false
            await game.loaded
            return !!game.hex
        })

        // Find two characters and one tile
        const objects = await page.evaluate(() => {
            const game = (window as any).games.game('GameX')
            const characters = [...game.population]
            // Search for a tile
            const tile = game.hex.getTile({ q: -11, r: 0 })
            return {
                charA: { uid: characters[0].uid },
                charB: { uid: characters[1].uid },
                tileId: tile.uid
            }
        })

        const { charA, charB, tileId } = objects
        console.log(`Objects found: CharA=${charA.uid}, CharB=${charB.uid}, Tile=${tileId}`)

        const selectAndVerify = async (id: string, label: string) => {
             const expectedUid = id
             console.log(`Step ${label}: Clicking object ${id}`)
             
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
             await expect(panel).toHaveAttribute('data-test-object-uid', expectedUid)
             
             console.log(`Step ${label}: Verified UID ${id}`)
        }

        // 1. Click Char A
        await selectAndVerify(charA.uid, '1. Char A')
        
        // 2. Click Tile
        await selectAndVerify(tileId, '2. Tile')
        
        // 3. Click Char B
        await selectAndVerify(charB.uid, '3. Char B')

        // 4. Click Char A again (via Tile)
        await selectAndVerify(tileId, '4a. Tile')
        await selectAndVerify(charA.uid, '4b. Char A')

        // 5. DIRECT SWITCH: Click Char B directly after Char A
        console.log('--- Direct Switch Start ---')
        await selectAndVerify(charB.uid, '5. Direct Switch to B')
        console.log('--- Direct Switch End ---')
        
        // 6. DIRECT SWITCH BACK: Click Char A directly after Char B
        console.log('--- Direct Switch Back Start ---')
        await selectAndVerify(charA.uid, '6. Direct Switch back to A')
        console.log('--- Direct Switch Back End ---')
    })
})
