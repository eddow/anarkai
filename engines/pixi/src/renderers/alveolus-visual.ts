import { Container, Sprite, Texture } from 'pixi.js'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { effect } from 'mutts'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { alveoli } from '../../assets/visual-content'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

const hasUsableTexture = (texture: Texture | undefined) => {
	if (!texture || texture === Texture.WHITE) return false
	const frame = texture.frame
	return frame.width > 0 && frame.height > 0
}

export class AlveolusVisual extends VisualObject<any> {
	private readonly scope: string
	private sprite: Sprite | undefined
	private goodsContainer: Container
	private _disposed = false

	constructor(alveolus: Alveolus, renderer: PixiGameRenderer) {
		super(alveolus, renderer)
		this.scope = `alveolus:${alveolus.uid}`
		this.view.name = this.scope
		// Ensure the building visual does not block mouse events (Tile handles selection)
		this.view.eventMode = 'none'
		this.goodsContainer = setPixiName(new Container(), scopedPixiName(this.scope, 'goods'))
	}

	public bind() {
		if (this._disposed) return
		const worldPos = toWorldCoord(this.object.tile.position)

		// Attach view to structures layer
		this.view.position.set(worldPos.x, worldPos.y)
		const alveoliLayer = this.renderer.layers?.alveoli
		if (!alveoliLayer) {
			console.warn('AlveolusVisual.bind: renderer.layers.alveoli is missing', {
				disposed: this._disposed,
				layers: !!this.renderer.layers,
			})
			return
		}
		alveoliLayer.addChild(this.view)

		// 1. Render Structure Sprite (on alveoli layer)
		this.register(
			effect`alveolus.${this.object.uid}.sprite`(() => {
				if (this._disposed) return
				const visualDef = alveoli[this.object.name]
				const textureName = visualDef?.sprites?.[0]
				if (textureName) {
					const tex = this.renderer.getTexture(textureName)
					if (hasUsableTexture(tex)) {
						if (!this.sprite) {
							this.sprite = setPixiName(new Sprite(), scopedPixiName(this.scope, 'sprite'))
							this.sprite.anchor.set(0.5)
							this.sprite.position.set(0, 0) // Relative to this.view
							this.view.addChild(this.sprite)
						}
						this.sprite.texture = tex

						// Smart scaling - User feedback: 9/8 (1.125)
						const targetSize = tileSize * (9 / 8)
						const maxDim = Math.max(this.sprite.texture.width, this.sprite.texture.height)

						if (maxDim > 1) {
							const scale = targetSize / maxDim
							this.sprite.scale.set(scale)
						} else {
							this.sprite.scale.set(1)
						}
					}
				} else {
					if (this.sprite) {
						this.sprite.destroy()
						this.sprite = undefined
					}
				}
			})
		)

		// 2. Render Goods (on storedGoods layer)
		// Goods need to be on a higher layer
		this.goodsContainer.position.set(worldPos.x, worldPos.y)
		const storedGoodsLayer = this.renderer.layers?.storedGoods
		if (!storedGoodsLayer) {
			console.warn('AlveolusVisual.bind: renderer.layers.storedGoods is missing')
		} else {
			storedGoodsLayer.addChild(this.goodsContainer)
		}

		const cleanupGoods = renderGoods(
			this.renderer,
			this.goodsContainer,
			tileSize,
			() => {
				const goods = this.object.storage?.renderedGoods()
				return { slots: goods ? goods.slots : [] }
			},
			{ x: 0, y: 0 }, // Relative since goodsContainer is at worldPos
			`alveolus.${this.object.uid}.goods`
		)
		this.register(cleanupGoods)
	}

	public dispose() {
		this._disposed = true
		if (this.sprite) {
			this.sprite.destroy()
		}
		this.goodsContainer.destroy({ children: true }) // Cleanup goods container
		super.dispose()
	}
}
