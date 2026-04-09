import { effect } from 'mutts'
import { Tile } from 'ssh/board/tile'
import type { GameObject } from 'ssh/game/object'
import { Character } from 'ssh/population/character'
import type { PixiGameRenderer } from './renderer'
import { BorderVisual } from './renderers/border-visual'
import { CharacterVisual } from './renderers/character-visual'
import { LooseGoodsVisual } from './renderers/loose-goods-visual'
import { TileVisual } from './renderers/tile-visual'
import type { VisualObject } from './renderers/visual-object'

export class VisualFactory {
	private cleanups: (() => void)[] = []

	constructor(private renderer: PixiGameRenderer) {}

	public bind() {
		console.log('[VisualFactory] Binding visuals...')
		const board = this.renderer.game.hex

		// 1. Tile gameplay overlays (content, zones, borders).
		// Ground terrain itself is rendered by TerrainVisual.
		console.log('[VisualFactory] Creating Tile Visuals...')
		board.tiles.forEach((tile: Tile) => {
			this.create(tile, TileVisual)
			tile.surroundings.forEach(({ border }) => {
				this.create(border, BorderVisual)
			})
		})

		// 2. LooseGoods Visual (Singleton Manager)
		console.log('[VisualFactory] Creating LooseGoods Visual...')
		this.create(board.looseGoods, LooseGoodsVisual)

		// 3. Character Visuals (Reactive Population)
		console.log('[VisualFactory] Binding Characters...')
		this.bindCharacters()

		// 4. Dynamically materialized objects (streamed tiles, late characters)
		this.bindGameObjects()
	}

	private bindCharacters() {
		const population = this.renderer.game.population

		// Watch for changes in population.
		// Assuming population.characters is iterable or we can just react to it.
		// If population is a GcClassed or has 'characters' list.
		// Based on Population class (viewed next), likely has `characters` array or map.

		this.cleanups.push(
			effect`visuals.characters`(() => {
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
			})
		)
	}

	private bindGameObjects() {
		this.cleanups.push(
			effect`visuals.gameObjects`(() => {
				for (const object of this.renderer.game.objects.values()) {
					if (this.renderer.visuals.has(object.uid)) continue
					if (object instanceof Tile) {
						this.create(object, TileVisual)
						object.surroundings.forEach(({ border }) => {
							this.create(border, BorderVisual)
						})
						continue
					}
					if (object instanceof Character) {
						this.create(object, CharacterVisual)
					}
				}
			})
		)
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
			this.renderer.worldScene.addChild(visual.view)
			this.renderer.attachToLayer(this.renderer.layers.ground, visual.view)
		} else if (visual instanceof CharacterVisual) {
			this.renderer.worldScene.addChild(visual.view)
		} else if (visual instanceof LooseGoodsVisual) {
			this.renderer.worldScene.addChild(visual.view)
		} else if (visual instanceof BorderVisual) {
			this.renderer.worldScene.addChild(visual.view)
			this.renderer.attachToLayer(this.renderer.layers.ground, visual.view)
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
		this.renderer.visuals.forEach((v) => v.dispose())
		this.renderer.visuals.clear()
		this.cleanups.forEach((c) => c())
	}
}
