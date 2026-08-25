/**
 * Icon resolution for atlas nodes — maps a projected node (kind + id) to the
 * image cytoscape should draw, plus optional spritesheet-crop geometry.
 *
 * Goods and buildings have standalone PNGs (`goods/berries.png`,
 * `buildings/chopper.png`). Natural resources (deposits) live as frames inside
 * the `objects/*` spritesheets, so they carry a crop rect to slice one frame
 * out of the sheet (cytoscape draws the full image and clips it to the node).
 */
import {
	alveoli as alveoliVisual,
	deposits as depositsVisual,
	goods as goodsVisual,
} from 'engine-rules/visual-content'

const RULES_ASSETS_ROOT = '/rules-assets'

export interface NodeIcon {
	/** URL of the image to draw (standalone PNG or spritesheet). */
	image: string
	/** Spritesheet-crop geometry (deposits). Absent for standalone PNG icons. */
	width?: number
	height?: number
	bgWidth?: number
	bgHeight?: number
	bgPosX?: number
	bgPosY?: number
}

/** Standalone `category.name` sprite → `/rules-assets/{category}/{name}.png`. */
function iconToUrl(sprite: string): string {
	const dot = sprite.indexOf('.')
	const category = dot >= 0 ? sprite.slice(0, dot) : sprite
	const name = dot >= 0 ? sprite.slice(dot + 1) : sprite
	return `${RULES_ASSETS_ROOT}/${category}/${name}.png`
}

/**
 * Representative object frames used as deposit icons, keyed by the sprite id
 * from `visual-content.deposits.*.icon` (`objects.{sheet}/{frame}`). Frame
 * rects mirror the source spritesheet JSONs; `sheetW`/`sheetH` are the full
 * sheet dimensions (from `file`, since the source JSONs omit them).
 */
const OBJECT_FRAMES: Record<
	string,
	{ sheet: string; x: number; y: number; w: number; h: number; sheetW: number; sheetH: number }
> = {
	'objects.bushes/bush1': { sheet: 'objects/bushes.png', x: 56, y: 6, w: 31, h: 29, sheetW: 432, sheetH: 112 },
	'objects.rocks/rock1': { sheet: 'objects/rocks.png', x: 22, y: 46, w: 58, h: 62, sheetW: 512, sheetH: 512 },
	'objects.trees/tree1': { sheet: 'objects/trees.png', x: 65, y: 1, w: 62, h: 74, sheetW: 800, sheetH: 192 },
	'objects.wheat/wheat-3': { sheet: 'objects/wheat.png', x: 0, y: 48, w: 58, h: 74, sheetW: 67, sheetH: 122 },
}

/** Resolve the icon for a projected node, or undefined if it has none. */
export function nodeIcon(kind: string, id: string): NodeIcon | undefined {
	let sprite: string | undefined
	if (kind === 'good') sprite = goodsVisual[id.slice('good:'.length)]?.icon
	else if (kind === 'building') sprite = alveoliVisual[id.slice('alveolus:'.length)]?.icon
	else if (kind === 'deposit') sprite = depositsVisual[id.slice('deposit:'.length)]?.icon
	if (!sprite) return undefined

	// Natural-resource frame → crop from the objects spritesheet.
	const frame = OBJECT_FRAMES[sprite]
	if (frame) {
		return {
			image: `${RULES_ASSETS_ROOT}/${frame.sheet}`,
			width: frame.w,
			height: frame.h,
			bgWidth: frame.sheetW,
			bgHeight: frame.sheetH,
			bgPosX: -frame.x,
			bgPosY: -frame.y,
		}
	}
	return { image: iconToUrl(sprite) }
}
