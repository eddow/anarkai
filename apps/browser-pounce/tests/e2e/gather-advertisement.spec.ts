
import { test, expect } from '@playwright/test';

test('gather-hut advertises collected goods', async ({ page }) => {
  test.setTimeout(120000); // Allow enough time for gravity and game loop

  // Navigate to the app
  await page.goto('/');
  await page.waitForSelector('.app-shell', { timeout: 10000 });

  // Wait for the game to initialize
  await page.waitForTimeout(2000);


  // Setup the scenario and verify the bug
  const result = await page.evaluate(async () => {
    try {
      const game = (window as any).games.game('GameX');
      if (!game) return { success: false, error: 'GameX not found' };

      // 1. Find a Gather Alveolus
      let gatherAlveolus = null;
      for (const tile of game.hex.tiles) {
        if (tile.content && tile.content.action && tile.content.action.type === 'gather') {
          gatherAlveolus = tile.content;
          break;
        }
      }

      if (!gatherAlveolus) {
        // Try to create one if not found (simplified for test stability, assuming we can or there is one)
        // For now, let's fail if not found to signal we need a better setup if default map doesn't have one
        return { success: false, error: 'No Gather Alveolus found in default map' };
      }

      const hive = gatherAlveolus.hive;
      const goodType = 'berries'; // Common gatherable

      // 2. Simulate dropping goods into the Gather Alveolus
      // We'll directly manipulate storage to simulate the "drop"
      // storage.add(goodType, 1) usually returns a token or void.
      // We need to verify what `storage` is.
      
      // Let's clear storage first to be sure
      // gatherAlveolus.storage.clear(); // If exists

      // Add goods
      gatherAlveolus.storage.addGood(goodType, 5);
      
      // 3. Wait a bit for reactivity to propagate
      // We can't use await new Promise(r => setTimeout(r, 100)) easily if not async, but we are async.
      await new Promise(resolve => setTimeout(resolve, 100));

      // 4. Check Hive advertisements
      // hive.advertisements is a reactive object/map
      // structure: { [goodType]: { advertisement: 'provide' | 'demand', priority: ..., advertisers: [...] } }
      
      const ads = hive.advertisements[goodType];
      
      if (!ads) {
        return { 
          success: false, 
          error: `No advertisement record found for ${goodType}. Storage stock: ${JSON.stringify(gatherAlveolus.storage.stock)}` 
        };
      }

      // We expect 'provide' advertisement
      if (ads.advertisement !== 'provide') {
        return { 
           success: false, 
           error: `Expected 'provide' advertisement, got '${ads.advertisement}'. Storage stock: ${JSON.stringify(gatherAlveolus.storage.stock)}` 
        };
      }
      
      // Check if our alveolus is among advertisers
      const isAdvertising = ads.advertisers.some((list: any[]) => list.includes(gatherAlveolus));
      
      const debugInfo = {
          stock: gatherAlveolus.storage.stock,
          reserved: gatherAlveolus.storage.slots.reduce((acc: number, s: any) => acc + (s?.reserved||0), 0),
          allocated: gatherAlveolus.storage.slots.reduce((acc: number, s: any) => acc + (s?.allocated||0), 0),
          available: gatherAlveolus.storage.available(goodType),
          hiveAds: hive.advertisements[goodType]
      };

      if (!isAdvertising) {
         return { 
           success: false, 
           error: `GatherAlveolus not found in advertisers for ${goodType}. State: ${JSON.stringify(debugInfo)}` 
        };
      }

      return { success: true, stock: gatherAlveolus.storage.stock };

    } catch (e: any) {
      return { success: false, error: e.toString(), stack: e.stack };
    }
  });

  if (!result.success) {
    console.error('Test verification failed:', result.error);
  }
  
  expect(result.success, `Bug reproduced: ${result.error}`).toBe(true);
});


// Since I need to act fast and iteratively, I'll write a test that dumps the game state 
// so I can see what's going on, then I'll refine it to be the reproduction case.
