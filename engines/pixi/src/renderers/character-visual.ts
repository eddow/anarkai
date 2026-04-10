import { effect } from 'mutts'
import { ColorMatrixFilter, Sprite } from 'pixi.js'
import type { Character } from 'ssh/population/character'
import { toWorldCoord } from 'ssh/utils/position' // Verify path
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

export class CharacterVisual extends VisualObject<Character> {
	private sprite: Sprite
	private vehicleSprite: Sprite
	private isHovered = false

	constructor(character: Character, renderer: PixiGameRenderer) {
		super(character, renderer)
		const scope = `character:${character.uid}`
		this.view.label = scope

		// Create container structure
		const charTex = renderer.getTexture('characters.default')
		this.sprite = setPixiName(
			new Sprite(charTex && (charTex as any).orig ? charTex : renderer.getTexture('empty')),
			scopedPixiName(scope, 'body')
		)
		this.sprite.anchor.set(0.5, 0.5)
		// User feedback: 90% (36px instead of 40px)
		this.sprite.width = 36
		this.sprite.height = 36

		const vehTex = renderer.getTexture('vehicles.byHands')
		this.vehicleSprite = setPixiName(
			new Sprite(vehTex && (vehTex as any).orig ? vehTex : renderer.getTexture('empty')),
			scopedPixiName(scope, 'vehicle')
		)
		this.vehicleSprite.anchor.set(0.5, 0.5)
		this.vehicleSprite.width = 30
		this.vehicleSprite.height = 30
		this.vehicleSprite.position.set(0, this.sprite.height * 0.15)

		this.view.addChild(this.sprite)
		this.view.addChild(this.vehicleSprite)
	}

	public bind() {
		this.renderer.attachToLayer(this.renderer.layers.characters, this.view)

		// Position binding
		this.register(
			effect`character.position`(() => {
				const world = toWorldCoord(this.object.position)
				// Need tileSize or similar context? toWorldCoord handles it if imports are correct
				if (world) {
					this.view.position.set(world.x, world.y)
					this.view.zIndex = world.y
				}
			})
		)

		// Hover effect
		const brightnessFilter = new ColorMatrixFilter()
		this.register(
			effect`character.${this.object.uid}.mouseover`(() => {
				this.renderHover(brightnessFilter)
			})
		)

		// 2. Render Goods
		const cleanupGoods = renderGoods(
			this.renderer,
			this.view,
			tileSize, // Slightly smaller for characters
			() => {
				const goods = this.object.carry?.renderedGoods()
				return goods
					? { slots: goods.slots, assumedMaxSlots: goods.assumedMaxSlots }
					: { slots: [] }
			},
			{ x: 0, y: 0 },
			`character.${this.object.uid}.goods`
		)
		this.register(cleanupGoods)
	}

	public dispose() {
		if (this.renderer.layers?.characters) {
			this.renderer.detachFromLayer(this.renderer.layers.characters, this.view)
		}
		super.dispose()
	}

	public setHoverActive(active: boolean) {
		if (this.isHovered === active) return
		this.isHovered = active
		this.renderHover()
	}

	private renderHover(brightnessFilter = new ColorMatrixFilter()) {
		if (this.isHovered) {
			this.sprite.tint = 0xaaaaff
			brightnessFilter.brightness(1.2, false)
			this.sprite.filters = [brightnessFilter]
		} else {
			this.sprite.tint = 0xffffff
			this.sprite.filters = []
		}
	}
}
