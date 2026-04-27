import { effect } from 'mutts'
import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import type { WorldVehicleType } from 'ssh/population/vehicle/vehicle'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

export function vehicleTextureKey(vehicleType: WorldVehicleType): string {
	switch (vehicleType) {
		case 'wheelbarrow':
			return 'vehicles.wheelbarrow'
	}
}

export class VehicleVisual extends VisualObject<VehicleEntity> {
	/** Drawn first (under {@link sprite}) when a driver is present; not used on the standalone character visual while driving. */
	private operatorSprite: Sprite
	private sprite: Sprite
	private isHovered = false

	constructor(vehicle: VehicleEntity, renderer: PixiGameRenderer) {
		super(vehicle, renderer)
		const scope = `vehicle:${vehicle.uid}`
		this.view.label = scope
		const charTex = renderer.getTexture('characters.default')
		const charUsable =
			charTex && charTex !== Texture.WHITE && charTex.frame.width > 0 && charTex.frame.height > 0
		this.operatorSprite = setPixiName(
			new Sprite(charUsable ? charTex : renderer.getTexture('empty')),
			scopedPixiName(scope, 'operator')
		)
		this.operatorSprite.anchor.set(0.5, 0.5)
		this.operatorSprite.width = 36
		this.operatorSprite.height = 36
		this.operatorSprite.visible = false

		const texKey = vehicleTextureKey(vehicle.vehicleType)
		const tex = renderer.getTexture(texKey)
		const usable = tex && tex !== Texture.WHITE && tex.frame.width > 0 && tex.frame.height > 0
		this.sprite = setPixiName(
			new Sprite(usable ? tex : renderer.getTexture('empty')),
			scopedPixiName(scope, 'body')
		)
		this.sprite.anchor.set(0.5, 0.5)
		this.sprite.width = 36
		this.sprite.height = 36
		this.view.addChild(this.operatorSprite)
		this.view.addChild(this.sprite)
	}

	public bind() {
		this.renderer.attachToLayer(this.renderer.layers.vehicles, this.view)

		this.register(
			effect`vehicle.position:${this.object.uid}`(() => {
				const position = this.object.position
				this.view.visible = !!position
				if (!position) return
				const world = toWorldCoord(position)
				if (world) {
					this.view.position.set(world.x, world.y)
					this.view.zIndex = world.y
				}
			})
		)

		this.register(
			effect`vehicle.operator-sprite:${this.object.uid}`(() => {
				let driver: Character | undefined
				for (const character of this.renderer.game.population) {
					if (character.driving && character.operates?.uid === this.object.uid) {
						driver = character
						break
					}
				}
				this.operatorSprite.visible = !!driver
			})
		)

		const cleanupGoods = renderGoods(
			this.renderer,
			this.view,
			tileSize,
			() => {
				const goods = this.object.storage.renderedGoods()
				return { slots: goods.slots, assumedMaxSlots: goods.assumedMaxSlots }
			},
			{ x: 0, y: 0 },
			`vehicle.${this.object.uid}.goods`
		)
		this.register(cleanupGoods)

		const brightnessFilter = new ColorMatrixFilter()
		this.register(
			effect`vehicle.${this.object.uid}.mouseover`(() => {
				this.renderHover(brightnessFilter)
			})
		)
	}

	public dispose() {
		if (this.renderer.layers?.vehicles) {
			this.renderer.detachFromLayer(this.renderer.layers.vehicles, this.view)
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
			this.operatorSprite.tint = 0xaaaaff
			brightnessFilter.brightness(1.2, false)
			this.sprite.filters = [brightnessFilter]
			const operatorBrightness = new ColorMatrixFilter()
			operatorBrightness.brightness(1.2, false)
			this.operatorSprite.filters = [operatorBrightness]
		} else {
			this.sprite.tint = 0xffffff
			this.operatorSprite.tint = 0xffffff
			this.sprite.filters = []
			this.operatorSprite.filters = []
		}
	}
}
