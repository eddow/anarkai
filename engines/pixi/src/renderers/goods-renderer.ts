import { effect } from 'mutts'
import { ColorMatrixFilter, Container, Graphics, Sprite } from 'pixi.js'
import type { RenderedGoodSlot } from 'ssh/storage/types'
import { goods as goodsCatalog } from '../../assets/visual-content'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'

let sharedGrayscaleFilter: ColorMatrixFilter | undefined

function getSharedGrayscaleFilter() {
	if (sharedGrayscaleFilter) return sharedGrayscaleFilter
	sharedGrayscaleFilter = new ColorMatrixFilter()
	sharedGrayscaleFilter.desaturate()
	return sharedGrayscaleFilter
}

export function renderGoods(
	renderer: PixiGameRenderer,
	container: Container,
	size: number,
	getSlots: () => { slots: RenderedGoodSlot[]; assumedMaxSlots?: number },
	worldPosition: { x: number; y: number },
	label: string
) {
	const scope = label.replace(/\./g, ':')
	const root = setPixiName(new Container(), scopedPixiName(scope, 'root'))
	root.eventMode = 'none'
	root.position.set(worldPosition.x, worldPosition.y)
	container.addChild(root)

	const cleanup = effect`${scope}`(() => {
		root.removeChildren().forEach((c) => c.destroy())

		const { slots, assumedMaxSlots } = getSlots()
		const n = assumedMaxSlots ?? slots.length
		if (n === 0) return

		const [centerIndex, around] = n === 1 || n === 5 ? [0, n - 1] : [-1, n]
		const radius = size * 0.4
		const spriteSize = size * 0.5

		for (let i = 0; i < n; i++) {
			const slot = slots[i]
			if (!slot) continue
			const slotScope = scopedPixiName(scope, `slot:${i}`)
			const isEmptySlot =
				!slot.goodType && slot.present === 0 && slot.reserved === 0 && slot.allocated === 0
			if (isEmptySlot) continue
			const goodDef = goodsCatalog[String(slot.goodType)]
			if (!goodDef || !goodDef.sprites) {
				console.warn('[GoodsRenderer] Missing visual definition for good:', slot.goodType)
				continue
			}

			let [x, y] = [0, 0]
			if (centerIndex !== i) {
				const angle = (i * 2 * Math.PI) / around
				x = Math.cos(angle) * radius
				y = Math.sin(angle) * radius
			}

			const texture = renderer.getTexture(goodDef.sprites[0])
			if (!texture || texture === (renderer as any).getTexture('empty')) {
				console.warn('[GoodsRenderer] Texture missing for:', goodDef.sprites[0])
			}
			if (!texture) continue

			const scale = spriteSize / texture.height
			const dy = spriteSize / 4
			const totalHeight = (slot.allowed + 1) * dy
			const presentOffset = dy - totalHeight / 2

			const gaugeWidth = spriteSize * 0.6
			const gauge = setPixiName(new Graphics(), scopedPixiName(slotScope, 'gauge'))
			gauge.eventMode = 'none'
			gauge.rect(x - gaugeWidth / 2, y - totalHeight / 2, gaugeWidth, totalHeight).fill({
				color: 0x000080,
				alpha: 0.5,
			})
			root.addChild(gauge)

			const drawSprites = (
				count: number,
				offset: number,
				kind: string,
				tint = 0xffffff,
				alpha = 1,
				filter?: boolean
			) => {
				for (let q = 0; q < count; q++) {
					const s = setPixiName(new Sprite(texture), scopedPixiName(slotScope, `${kind}:${q}`))
					s.eventMode = 'none'
					s.scale.set(scale)
					s.anchor.set(0.5)
					s.position.set(x, y - q * dy - offset)
					s.tint = tint
					s.alpha = alpha
					if (filter) s.filters = [getSharedGrayscaleFilter()]
					root.addChild(s)
				}
			}

			drawSprites(slot.present, presentOffset, 'present')
			const reservedOffset = presentOffset + slot.present * dy
			drawSprites(slot.reserved, reservedOffset, 'reserved', 0xff6666, 0.7)
			const allocatedOffset = reservedOffset + slot.reserved * dy
			drawSprites(slot.allocated, allocatedOffset, 'allocated', 0xffffff, 0.5, true)
		}
	})

	return () => {
		cleanup()
		root.destroy({ children: true })
		container.removeChild(root)
	}
}
