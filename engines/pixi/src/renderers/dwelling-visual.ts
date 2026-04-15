import { effect } from 'mutts'
import { Container, Sprite, Texture } from 'pixi.js'
import type { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { dwellings } from '../../assets/visual-content'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

const hasUsableTexture = (texture: Texture | undefined) => {
	if (!texture || texture === Texture.WHITE) return false
	const frame = texture.frame
	return frame.width > 0 && frame.height > 0
}

function dwellingVisualKey(
	content: BasicDwelling | BuildDwelling
): keyof typeof dwellings | undefined {
	// Construction shells should stay visible only through zoning/borders and stored goods.
	// The cabin sprite is reserved for completed dwellings.
	if (content instanceof BuildDwelling) return undefined
	return 'basic_dwelling'
}

let dwellingVisualInstanceCounter = 0

export class DwellingVisual extends VisualObject<BasicDwelling | BuildDwelling> {
	private readonly scope: string
	private sprite: Sprite | undefined
	private goodsContainer: Container
	private _disposed = false

	constructor(dwelling: BasicDwelling | BuildDwelling, renderer: PixiGameRenderer) {
		super(dwelling, renderer)
		dwellingVisualInstanceCounter += 1
		this.scope = `dwelling:${dwelling.uid}:instance:${dwellingVisualInstanceCounter}`
		this.view.label = this.scope
		this.view.eventMode = 'none'
		this.goodsContainer = setPixiName(new Container(), scopedPixiName(this.scope, 'goods'))
	}

	public bind() {
		if (this._disposed) return
		const worldPos = toWorldCoord(this.object.tile.position)

		this.view.position.set(0, 0)
		this.view.zIndex = worldPos.y
		const alveoliLayer = this.renderer.layers?.alveoli
		if (!alveoliLayer) {
			console.warn('DwellingVisual.bind: renderer.layers.alveoli is missing', {
				disposed: this._disposed,
				layers: !!this.renderer.layers,
			})
			return
		}
		this.renderer.attachToLayer(alveoliLayer, this.view)

		this.register(
			effect`${this.scope}.sprite`(() => {
				if (this._disposed) return
				const key = dwellingVisualKey(this.object)
				const visualDef = key ? dwellings[key] : undefined
				const textureName = visualDef?.sprites?.[0] ?? visualDef?.icon ?? visualDef?.background
				if (textureName) {
					const tex = this.renderer.getTexture(textureName)
					if (hasUsableTexture(tex)) {
						if (!this.sprite) {
							this.sprite = setPixiName(new Sprite(), scopedPixiName(this.scope, 'sprite'))
							this.sprite.anchor.set(0.5)
							this.sprite.position.set(0, 0)
							this.view.addChild(this.sprite)
						}
						this.sprite.texture = tex
						const targetSize = tileSize * (9 / 8)
						const maxDim = Math.max(this.sprite.texture.width, this.sprite.texture.height)
						if (maxDim > 1) {
							this.sprite.scale.set(targetSize / maxDim)
						} else {
							this.sprite.scale.set(1)
						}
					}
				} else if (this.sprite) {
					this.sprite.destroy()
					this.sprite = undefined
				}
			})
		)

		if (this.goodsContainer.parent !== this.view) {
			this.view.addChild(this.goodsContainer)
		}
		this.goodsContainer.position.set(0, 0)
		this.goodsContainer.zIndex = worldPos.y
		const storedGoodsLayer = this.renderer.layers?.storedGoods
		if (!storedGoodsLayer) {
			console.warn('DwellingVisual.bind: renderer.layers.storedGoods is missing')
		} else {
			this.renderer.attachToLayer(storedGoodsLayer, this.goodsContainer)
		}

		const cleanupGoods = renderGoods(
			this.renderer,
			this.goodsContainer,
			tileSize,
			() => {
				const goods = this.object.storage?.renderedGoods()
				return goods
					? { slots: goods.slots, assumedMaxSlots: goods.assumedMaxSlots }
					: { slots: [] }
			},
			{ x: 0, y: 0 },
			`${this.scope}.goods`
		)
		this.register(cleanupGoods)
	}

	public dispose() {
		this._disposed = true
		if (this.renderer.layers?.alveoli) {
			this.renderer.detachFromLayer(this.renderer.layers.alveoli, this.view)
		}
		if (this.renderer.layers?.storedGoods) {
			this.renderer.detachFromLayer(this.renderer.layers.storedGoods, this.goodsContainer)
		}
		if (this.sprite) {
			this.sprite.destroy()
		}
		this.goodsContainer.destroy({ children: true })
		super.dispose()
	}
}
