import { Container } from 'pixi.js'
import type { GameObject } from 'ssh/src/lib/game/object'
import type { Tile } from 'ssh/src/lib/board/tile'
import type { Character } from 'ssh/src/lib/population/character'
import type { PixiGameRenderer } from './renderer'
import { TileVisual } from './renderers/tile-visual'
import { CharacterVisual } from './renderers/character-visual'
import { FreeGoodsVisual } from './renderers/free-goods-visual'
import { BorderVisual } from './renderers/border-visual'
import { VisualObject } from './renderers/visual-object'
import { namedEffect } from 'ssh/src/lib/debug'


export class VisualFactory {
    private cleanups: (() => void)[] = []

    constructor(private renderer: PixiGameRenderer) {}

    public bind() {
        console.log('[VisualFactory] Binding visuals...')
        const board = this.renderer.game.hex
        
        // 1. Tile Visuals
        console.log('[VisualFactory] Creating Tile Visuals...')
        board.tiles.forEach((tile: Tile) => {
            this.create(tile, TileVisual)
            
            // 2. Border Visuals (traverse via tiles)
            // Note: This iterates borders multiple times, but create() dedups by UID
            tile.surroundings.forEach(({ border }) => {
                this.create(border, BorderVisual)
            })
        })

        // 3. FreeGoods Visual (Singleton Manager)
        console.log('[VisualFactory] Creating FreeGoods Visual...')
        this.create(board.freeGoods, FreeGoodsVisual)

        // 4. Character Visuals (Reactive Population)
        console.log('[VisualFactory] Binding Characters...')
        this.bindCharacters()
    }
    
    private bindCharacters() {
         const population = this.renderer.game.population
         
         // Watch for changes in population.
         // Assuming population.characters is iterable or we can just react to it.
         // If population is a GcClassed or has 'characters' list. 
         // Based on Population class (viewed next), likely has `characters` array or map.
         
         this.cleanups.push(namedEffect('visuals.characters', () => {
             // Reactive set of active characters
             const activeChars = new Set<Character>()
             
             // Iterate population (assuming iterator or property)
             for (const char of population) {
                 activeChars.add(char)
                 if (!this.renderer.visuals.has(char.uid)) {
                     this.create(char, CharacterVisual)
                 }
             }
             
             // Cleanup missing characters (if they were removed from population but not destroyed?)
             // VisualObject usually cleans up on dispose, but we might want to ensure sync.
             // Actually, if a character is destroyed, it should be removed from population.
             // And we should dispose the visual.
             
             // Check for visuals that are characters but no longer in activeChars
             for (const [uid, visual] of this.renderer.visuals) {
                 if (visual instanceof CharacterVisual && !activeChars.has(visual.object)) {
                     visual.dispose()
                     this.renderer.visuals.delete(uid)
                 }
             }
         }))
    }

    private create<T extends GameObject>(
        object: T, 
        VisualClass: new (obj: T, renderer: PixiGameRenderer) => VisualObject<T>
    ) {
        if (!this.renderer?.app) return
        if (this.renderer.visuals.has(object.uid)) return
        
        let visual: VisualObject<T> | undefined

        try {
            visual = new VisualClass(object, this.renderer)
            visual.bind()
            this.renderer.visuals.set(object.uid, visual)
        } catch (e) {
            console.error('[VisualFactory] Error creating visual:', e)
            return
        }

        if (!visual) return

        // Handle layer attachment if visual doesn't do it itself
        // TileVisual handles its own layers inside its container, but where does container go?
        // TileVisual should attach to 'ground' layer?
        
        if (visual instanceof TileVisual) {
             this.renderer.layers.ground.addChild(visual.view)
        } else if (visual instanceof CharacterVisual) {
             this.renderer.layers.characters.addChild(visual.view)
        } else if (visual instanceof FreeGoodsVisual) {
             // FreeGoodsVisual handles its own attachment (storedGoods layer usually, inside its class)
             // But VisualObject.view is what we generically attach.
             // FreeGoodsVisual implementation I wrote attached internal container to storedGoods.
             // So here we might not need to attach view?
             // Actually VisualObject base creates `this.view`.
             // If child class attaches specialized containers to layers, `this.view` might be empty.
             // Let's leave it detatched or attach to ground?
             // Best to just check if it needs attachment.
             // FreeGoodsVisual attached `this.container` to `renderer.layers.storedGoods`.
             // So we don't attach visual.view.
        } else if (visual instanceof BorderVisual) {
             // BorderVisual also managed its own layers (gateGraphics to alveoli, goods to storedGoods).
        }
        
        // Cleanup when object executes destroy? 
        // VisualObject should persist until GameObject is destroyed.
        // We can hook into GameObject.destroyed? 
        if ('destroyed' in object) {
            // Watch destroyed property if reactive
        }
    }

    public destroy() {
        // Destroy all visuals
        this.renderer.visuals.forEach(v => v.dispose())
        this.renderer.visuals.clear()
        this.cleanups.forEach(c => c())
    }
}
