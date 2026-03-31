import { effect } from 'mutts'
import { Container, Sprite, Texture } from 'pixi.js'
import type { LooseGood, LooseGoods } from 'ssh/board/looseGoods'
import { toWorldCoord } from 'ssh/utils/position' // Verify import
import { tileSize } from 'ssh/utils/varied'
import { goods as goodsCatalog } from '../../assets/visual-content'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { VisualObject } from './visual-object'

export class LooseGoodsVisual extends VisualObject<LooseGoods> {
	private spritePool: Sprite[] = []
	private activeSprites = new Map<LooseGood, Sprite>()
	private container: Container

	constructor(looseGoods: LooseGoods, renderer: PixiGameRenderer) {
		super(looseGoods, renderer)
		const scope = `looseGoods:${looseGoods.uid}`
		this.view.label = scope
		this.container = setPixiName(new Container(), scopedPixiName(scope, 'container'))
		// Ensure this container (and its children) does not block mouse events
		this.container.eventMode = 'none'
		this.renderer.layers.looseGoods.addChild(this.container)
	}

	public bind() {
		this.register(
			effect`looseGoods.render`(() => {
				// We need to iterate over all goods.
				// LooseGoods.goods is a Map<AxialKey, LooseGood[]>
				// Ideally we iterate only visible processing, but here we do all for simplicity first.

				// Track seen goods to remove vanished ones
				const seen = new Set<LooseGood>()

				// console.log('[LooseGoodsVisual] Rendering. Goods entries:', Array.from((this.object as any).goods.entries()).length)

				// Track goods count per coordinate for stacking offset
				const coordCounts = new Map<string, number>()

				for (const [coord, goodsList] of (this.object as any).goods.entries()) {
					const count = coordCounts.get(coord) ?? 0
					coordCounts.set(coord, count + goodsList.length)
				}

				// Reset counter for actual rendering
				const coordIndices = new Map<string, number>()

				for (const [coord, goodsList] of (this.object as any).goods.entries()) {
					for (const good of goodsList) {
						// Log first good found
						// console.log('[LooseGoodsVisual] Good:', good.goodType, good.available, good.position)

						// FIX: Allocated goods should still be visible until removed!
						// if (!good.available) continue

						seen.add(good)
						let sprite = this.activeSprites.get(good)
						if (!sprite) {
							sprite = this.getSprite()
							setPixiName(sprite, `looseGood:${String(good.goodType)}:${this.activeSprites.size}`)
							this.activeSprites.set(good, sprite)
							this.container.addChild(sprite)

							const def = (goodsCatalog as any)[good.goodType]
							if (def?.sprites?.[0]) {
								const textureKey = def.sprites[0]
								const texture = this.renderer.getTexture(textureKey)
								sprite.texture = texture

								if (texture === Texture.WHITE) {
									console.warn('[LooseGoodsVisual] Missing texture for:', textureKey)
								}

								// Scale?
								const scale = (tileSize * 0.5) / (sprite.texture.height || 20)
								sprite.scale.set(scale)
							} else {
								console.warn('[LooseGoodsVisual] No definition for goodType:', good.goodType)
							}
						}

						// Update position for both new and existing sprites
						const world = toWorldCoord(good.position) // Position might be Positioned or string?
						// Good position is usually 'Position'.
						if (world) {
							// Add small offset for stacking when multiple goods are on same coordinate
							const currentIndex = coordIndices.get(coord) ?? 0
							coordIndices.set(coord, currentIndex + 1)
							const totalOnCoord = coordCounts.get(coord) ?? 1

							// Calculate offset: spread goods in a small circle
							const offsetRadius = Math.min(totalOnCoord * 2, 8) // Max 8px radius
							const angle = (currentIndex * 2 * Math.PI) / totalOnCoord
							const offsetX = Math.cos(angle) * offsetRadius
							const offsetY = Math.sin(angle) * offsetRadius

							sprite.position.set(world.x + offsetX, world.y + offsetY)
						} else {
							console.warn('[LooseGoodsVisual] Invalid world pos for good:', good.position)
						}
						sprite.tint = good.available ? 0xffffff : 0xff6666
					}
				}

				// Cleanup removed goods
				for (const [good, sprite] of this.activeSprites) {
					if (!seen.has(good)) {
						this.returnSprite(sprite)
						this.activeSprites.delete(good)
					}
				}
			})
		)
	}

	private getSprite(): Sprite {
		const s = this.spritePool.pop() || setPixiName(new Sprite(), 'looseGood:pooled')
		s.anchor.set(0.5)
		return s
	}

	private returnSprite(s: Sprite) {
		s.label = 'looseGood:pooled'
		s.tint = 0xffffff
		s.parent?.removeChild(s)
		this.spritePool.push(s)
	}

	public dispose() {
		this.container.destroy({ children: true }) // destroys all sprites
		super.dispose()
	}
}
