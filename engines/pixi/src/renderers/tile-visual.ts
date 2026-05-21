import { interactionMode } from '@app/lib/interactive-state'
import { effect } from 'mutts'
import {
	ColorMatrixFilter,
	Container,
	Graphics,
	Point,
	Sprite,
	Texture,
	type TilingSprite,
} from 'pixi.js'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { Tile } from 'ssh/board/tile'
import type { RenderedGoodSlots } from 'ssh/storage/types'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { AlveolusVisual } from './alveolus-visual'
import { DwellingVisual } from './dwelling-visual'
import { createGoodsRenderer, type GoodsRenderer } from './goods-renderer'
import { createTerrainHexSprite } from './terrain-hex-sprite'
import { VisualObject } from './visual-object'

export class TileVisual extends VisualObject<Tile> {
	private static readonly OVERLAY_Z_OFFSET = 1_000_000
	private tileContainer: Container
	private backgroundSprite: TilingSprite
	private contentContainer: Container
	private genericGoodsContainer: Container
	private genericGoodsRenderer: GoodsRenderer | undefined
	private genericGoodsSource: { renderedGoods?: () => RenderedGoodSlots } | undefined
	private zoneBorder: Graphics
	private cityHallSprite: Sprite | undefined

	// Cache for interaction state to avoid redundant updates
	private cachedBrightness = 1
	private cachedTint = 0xffffff
	private cachedBorderColor = 0

	constructor(tile: Tile, renderer: PixiGameRenderer) {
		super(tile, renderer)
		const scope = `tile:${tile.uid}`

		this.view.label = scope
		this.tileContainer = setPixiName(new Container(), scopedPixiName(scope, 'container'))
		this.view.addChild(this.tileContainer)

		// Setup layers
		const backgroundLayer = setPixiName(new Container(), scopedPixiName(scope, 'backgroundLayer'))
		this.contentContainer = setPixiName(new Container(), scopedPixiName(scope, 'content'))
		this.genericGoodsContainer = setPixiName(new Container(), scopedPixiName(scope, 'goods'))
		this.tileContainer.addChild(backgroundLayer, this.contentContainer)

		this.zoneBorder = setPixiName(new Graphics(), scopedPixiName(scope, 'zoneBorder'))
		this.tileContainer.addChild(this.zoneBorder)

		// Initialize background (won't change often)
		const bgTex = renderer.getTexture('terrain.grass')
		const world = toWorldCoord(tile.position)
		const { sprite, container } = createTerrainHexSprite({
			scope: scopedPixiName(scope, 'terrain'),
			texture: bgTex && (bgTex as any).orig ? bgTex : renderer.getTexture('empty'),
			position: { x: 0, y: 0 },
			tileOrigin: world ?? { x: 0, y: 0 },
		})
		this.backgroundSprite = sprite
		// TerrainVisual is the canonical terrain renderer.
		// Keep TileVisual for content and gameplay overlays, but hide its ground texture.
		this.backgroundSprite.alpha = 0
		backgroundLayer.addChild(container)

		// Position
		if (world) {
			this.view.position.set(world.x, world.y)
			// Keep tile overlays above streamed terrain regardless of board quadrant,
			// while preserving front/back ordering between tiles.
			this.view.zIndex = TileVisual.OVERLAY_Z_OFFSET + world.y
		}
	}

	private currentContentVisual: VisualObject<any> | undefined
	private isHovered = false

	public bind() {
		const brightnessFilter = new ColorMatrixFilter()

		// React to content changes and specific interactions
		this.register(
			effect`tile.${this.object.uid}.render`(() => {
				const content = this.object.content

				// Manage Content Visual
				if (this.currentContentVisual && this.currentContentVisual.object !== content) {
					this.currentContentVisual.dispose()
					this.currentContentVisual = undefined
				}

				if (content && !this.currentContentVisual) {
					if (content instanceof Alveolus) {
						this.currentContentVisual = new AlveolusVisual(content, this.renderer)
						this.contentContainer.addChild(this.currentContentVisual.view)
						this.currentContentVisual.bind()
					} else if (content instanceof BasicDwelling || content instanceof BuildDwelling) {
						this.currentContentVisual = new DwellingVisual(content, this.renderer)
						this.contentContainer.addChild(this.currentContentVisual.view)
						this.currentContentVisual.bind()
					}
				}
				this.syncGenericStoredGoods()
				this.syncCityHallIcon()

				// Update background texture based on content
				if (content) {
					let bgName = (content as any).background
					if (bgName) {
						if (!bgName.includes('.')) {
							bgName = `terrain.${bgName}`
						}
						const tex = this.renderer.getTexture(bgName)
						if (!tex || tex === (this.renderer as any).getTexture('empty')) {
							// console.warn(`[TileVisual] Missing bg texture: ${bgName} (orig: ${(content as any).background})`)
						}
						this.backgroundSprite.texture = tex
					}
				}
			})
		)

		this.register(
			effect`tile.${this.object.uid}.interaction`(() => {
				this.renderInteraction(brightnessFilter)
			})
		)
	}

	private getCityHallTexture(): Texture {
		const texture = this.renderer.getTexture('buildings.city-hall')
		if (!(texture instanceof Texture)) return Texture.WHITE
		const source = (texture as { source?: { width?: number; height?: number } } | undefined)?.source
		if (!texture || !source || !source.width || !source.height) return Texture.WHITE
		return texture
	}

	private syncCityHallIcon() {
		const coord = toAxialCoord(this.object.position)
		const profile = coord
			? this.renderer.game?.getSettlementTradeProfileAtCityHall?.(coord)
			: undefined
		if (!profile) {
			if (this.cityHallSprite) {
				this.cityHallSprite.destroy()
				this.cityHallSprite = undefined
			}
			return
		}
		const texture = this.getCityHallTexture()
		if (!this.cityHallSprite) {
			this.cityHallSprite = setPixiName(
				new Sprite(texture),
				scopedPixiName(`tile:${this.object.uid}`, 'cityHall')
			)
			this.cityHallSprite.anchor.set(0.5, 0.62)
			this.tileContainer.addChild(this.cityHallSprite)
		}
		this.cityHallSprite.texture = texture
		const maxDim = Math.max(texture.width, texture.height)
		const targetSize = tileSize * 0.95
		this.cityHallSprite.scale.set(maxDim > 0 ? targetSize / maxDim : 1)
	}

	public setHoverActive(active: boolean) {
		if (this.isHovered === active) return
		this.isHovered = active
		this.renderInteraction()
	}

	public refreshStoredGoods() {
		const visual = this.currentContentVisual
		if (
			visual &&
			'refreshStoredGoods' in visual &&
			typeof visual.refreshStoredGoods === 'function'
		) {
			visual.refreshStoredGoods()
		}
		this.syncGenericStoredGoods()
	}

	private syncGenericStoredGoods() {
		const content = this.object.content as
			| {
					storage?: { renderedGoods?: () => RenderedGoodSlots }
					foundationStorage?: { renderedGoods?: () => RenderedGoodSlots }
			  }
			| undefined
		const storage = this.currentContentVisual
			? undefined
			: content?.storage?.renderedGoods
				? content.storage
				: content?.foundationStorage
		const renderedGoods = storage?.renderedGoods
		if (!renderedGoods) {
			this.genericGoodsRenderer?.dispose()
			this.genericGoodsRenderer = undefined
			this.genericGoodsSource = undefined
			if (this.renderer.layers?.storedGoods) {
				this.renderer.detachFromLayer(this.renderer.layers.storedGoods, this.genericGoodsContainer)
			}
			if (this.genericGoodsContainer.parent === this.view) {
				this.view.removeChild(this.genericGoodsContainer)
			}
			return
		}

		if (this.genericGoodsRenderer && this.genericGoodsSource !== storage) {
			this.genericGoodsRenderer.dispose()
			this.genericGoodsRenderer = undefined
			this.genericGoodsSource = undefined
		}

		if (!this.genericGoodsRenderer) {
			this.genericGoodsSource = storage
			const worldPos = toWorldCoord(this.object.position)
			if (this.genericGoodsContainer.parent !== this.view) {
				this.view.addChild(this.genericGoodsContainer)
			}
			this.genericGoodsContainer.position.set(0, 0)
			this.genericGoodsContainer.zIndex = worldPos.y
			const storedGoodsLayer = this.renderer.layers?.storedGoods
			if (storedGoodsLayer) {
				this.renderer.attachToLayer(storedGoodsLayer, this.genericGoodsContainer)
			}
			this.genericGoodsRenderer = createGoodsRenderer(
				this.renderer,
				this.genericGoodsContainer,
				tileSize,
				() => {
					const goods = renderedGoods.call(storage)
					return goods
						? { slots: goods.slots, assumedMaxSlots: goods.assumedMaxSlots }
						: { slots: [] }
				},
				{ x: 0, y: 0 },
				`tile:${this.object.uid}.goods`
			)
		}
		this.genericGoodsRenderer.render()
	}

	public refreshDockedVehicles() {
		const visual = this.currentContentVisual
		if (
			visual &&
			'refreshDockedVehicles' in visual &&
			typeof visual.refreshDockedVehicles === 'function'
		) {
			visual.refreshDockedVehicles()
		}
	}

	private renderInteraction(brightnessFilter = new ColorMatrixFilter()) {
		const content = this.object.content
		let brightness = 1
		let tint = 0xffffff
		let borderColor = 0
		const isActive = this.isHovered

		if (isActive) {
			const action = interactionMode.selectedAction
			const canInteract = this.object.canInteract(action)

			if (action && canInteract) {
				if (action.startsWith('zone:')) {
					const zoneType = action.replace('zone:', '')
					const custom = this.object.board.zoneManager.getZoneDefinition(zoneType)?.color
					tint = custom
						? Number.parseInt(custom.replace(/^#/, ''), 16)
						: zoneType === 'residential'
							? 0x88ff88
							: zoneType === 'harvest'
								? 0xddbb99
								: 0xbbbbbb
					brightness = 1.16
				} else {
					tint = 0x7fb8ff
					brightness = 1.32
				}
			} else if (!action || action === '' || action === 'select') {
				tint = 0x7fb8ff
				brightness = 1.32
			}
		}

		if (content && (content as any).colorCode) {
			const cc =
				typeof (content as any).colorCode === 'function' ? (content as any).colorCode() : null
			if (cc) {
				if (!isActive && cc.tint) tint = cc.tint
				if (cc.borderColor) borderColor = cc.borderColor
			}
		}

		if (!borderColor) {
			const zone = this.object.effectiveZone
			if (zone === 'residential') borderColor = 0x44dd44
			else if (zone === 'harvest') borderColor = 0xaa7744
			else if (zone) {
				const color = this.object.board.zoneManager.getZoneDefinition(zone)?.color
				if (color) borderColor = Number.parseInt(color.replace(/^#/, ''), 16)
			}
		}

		const tintChanged = this.cachedTint !== tint
		const brightnessChanged = this.cachedBrightness !== brightness
		const borderChanged = this.cachedBorderColor !== borderColor

		if (tintChanged) {
			this.backgroundSprite.tint = tint
			this.cachedTint = tint
		}

		if (brightnessChanged) {
			this.cachedBrightness = brightness
			if (brightness !== 1) {
				brightnessFilter.brightness(brightness, false)
				this.backgroundSprite.filters = [brightnessFilter]
			} else {
				this.backgroundSprite.filters = []
			}
		}

		if (borderChanged) {
			this.cachedBorderColor = borderColor
			this.zoneBorder.clear()
			if (borderColor) {
				const innerSize = tileSize - 3 / 4
				const points = Array.from({ length: 6 }, (_, i) => {
					const angle = (Math.PI / 3) * (i + 0.5)
					return new Point(Math.cos(angle) * innerSize, Math.sin(angle) * innerSize)
				})
				this.zoneBorder.poly(points).stroke({ width: 1.5, color: borderColor })
			}
		}
	}

	public dispose() {
		if (this.renderer.layers?.ground) {
			this.renderer.detachFromLayer(this.renderer.layers.ground, this.view)
		}
		this.genericGoodsRenderer?.dispose()
		if (this.renderer.layers?.storedGoods) {
			this.renderer.detachFromLayer(this.renderer.layers.storedGoods, this.genericGoodsContainer)
		}
		this.cityHallSprite?.destroy()
		this.cityHallSprite = undefined
		this.currentContentVisual?.dispose()
		super.dispose()
	}
}
