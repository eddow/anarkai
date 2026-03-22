import { Container, Sprite } from 'pixi.js'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { effect } from 'mutts'
import { LCG, subSeed } from 'ssh/utils/numbers'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { deposits as visualDeposits } from '../../assets/visual-content'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { VisualObject } from './visual-object'

export class UnBuiltLandVisual extends VisualObject<UnBuiltLand> {
	private unbuiltContainer: Container

	constructor(content: UnBuiltLand, renderer: PixiGameRenderer) {
		super(content, renderer)
		const scope = `unbuilt:${content.uid}`
		this.view.name = scope
		// Ensure deposit visuals do not block mouse events
		this.view.eventMode = 'none'
		this.unbuiltContainer = setPixiName(new Container(), scopedPixiName(scope, 'deposits'))
		this.view.addChild(this.unbuiltContainer)
	}

	public bind() {
		// Attach to resources layer
		const worldPos = toWorldCoord(this.object.tile.position)
		this.view.position.set(worldPos.x, worldPos.y)
		this.renderer.layers.resources.addChild(this.view)

		this.register(
			effect`unbuilt.${this.object.uid}.render`(() => {
				// Clear previous sprites
				this.unbuiltContainer.removeChildren().forEach((c) => c.destroy())

				// Render deposits (scattered)
				const deposit = this.object.deposit
				if (deposit && deposit.amount > 0) {
					const currentCount = Math.max(1, Math.floor(deposit.amount))
					const meanQuantity = Math.max(1, (deposit as any).maxAmount ?? currentCount)

					// Legacy scaling logic: inverse sqrt of quantity, min 0.5
					const areaScale = Math.max(2 / Math.sqrt(meanQuantity), 0.5)

					const tileCoord = toAxialCoord(this.object.tile.position)!

					for (let i = 0; i < currentCount; i++) {
						const seed = subSeed('deposit-unit', tileCoord.q, tileCoord.r, i)
						const rnd = LCG('gameSeed', seed)

						const depositName =
							deposit.name ||
							(deposit.constructor as { resourceName?: string; key?: string }).resourceName ||
							(deposit.constructor as { resourceName?: string; key?: string }).key
						const def = depositName ? visualDeposits[depositName] : undefined
						if (!def || !def.sprites || def.sprites.length === 0) continue

						// Pick random variant based on seed
						const spriteIndex = Math.floor(rnd() * def.sprites.length)
						const spriteKey = def.sprites[spriteIndex]

						const tex = this.renderer.getTexture(spriteKey)
						if (!tex || tex === (this.renderer as any).getTexture('empty')) continue

						const sprite = setPixiName(new Sprite(tex), `deposit:${this.object.uid}/sprite:${i}`)
						sprite.anchor.set(0.5, 1.0) // Bottom-center anchor for grounding

						// Scale
						// Base scale to fit tile, then shrink by areaScale
						const base = Math.max(sprite.width, sprite.height) / tileSize
						const scale = (1 / base) * areaScale * 0.7 // 0.7 to match user preference closer? Legacy was * 1.
						sprite.scale.set(scale)

						// Position logic from legacy (Uniform Hexagon)
						const u = rnd() * 2 - 1
						const v = rnd() * 2 - 1
						const absU = Math.abs(u)
						const absV = Math.abs(v)
						const s = absU + absV
						const qOff = ((u * 0.4) / Math.max(s, 1e-10)) * Math.min(s, 1)
						const rOff = ((v * 0.4) / Math.max(s, 1e-10)) * Math.min(s, 1)

						// Convert offset to relative pixel position
						const offsetWorld = toWorldCoord({ q: qOff, r: rOff })!

						sprite.position.set(offsetWorld.x, offsetWorld.y)

						this.unbuiltContainer.addChild(sprite)
					}
				}

				// Cleanup function returned by effect
				return () => {
					this.unbuiltContainer.removeChildren().forEach((c) => c.destroy())
				}
			})
		)
	}

	public dispose() {
		this.unbuiltContainer.destroy({ children: true })
		super.dispose()
	}
}
