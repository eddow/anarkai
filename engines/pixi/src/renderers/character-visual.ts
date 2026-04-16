import { effect } from 'mutts'
import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import type { Character } from 'ssh/population/character'
import { toWorldCoord } from 'ssh/utils/position'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { VisualObject } from './visual-object'

export class CharacterVisual extends VisualObject<Character> {
	private sprite: Sprite
	private isHovered = false

	constructor(character: Character, renderer: PixiGameRenderer) {
		super(character, renderer)
		const scope = `character:${character.uid}`
		this.view.label = scope

		const charTex = renderer.getTexture('characters.default')
		const charUsable =
			charTex && charTex !== Texture.WHITE && charTex.frame.width > 0 && charTex.frame.height > 0
		this.sprite = setPixiName(
			new Sprite(charUsable ? charTex : renderer.getTexture('empty')),
			scopedPixiName(scope, 'body')
		)
		this.sprite.anchor.set(0.5, 0.5)
		this.sprite.width = 36
		this.sprite.height = 36

		this.view.addChild(this.sprite)
	}

	public bind() {
		this.renderer.attachToLayer(this.renderer.layers.characters, this.view)

		this.register(
			effect`character.world:${this.object.uid}`(() => {
				if (this.object.driving) {
					this.view.visible = false
					return
				}
				this.view.visible = true
				const world = toWorldCoord(this.object.position)
				if (!world) return
				this.view.position.set(world.x, world.y)
				this.view.zIndex = world.y
			})
		)

		const brightnessFilter = new ColorMatrixFilter()
		this.register(
			effect`character.${this.object.uid}.mouseover`(() => {
				this.renderHover(brightnessFilter)
			})
		)
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
