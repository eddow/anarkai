import { type Rectangle, Sprite, Texture } from 'pixi.js'
import type { RoadType } from 'ssh/board/roads'
import { type AxialCoord, axial, cartesian, hexSides } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import {
	roadEdgeFade,
	roadFallbackRgb,
	roadMaterialSpec,
	roadMaterialWorldSize,
	roadPathWidth,
	roadTileTexturePixels,
	roadTileWorldSize,
} from './road-definitions'

interface RoadContribution {
	readonly borderCoord: AxialCoord
	readonly type: RoadType
	readonly end: { x: number; y: number }
	readonly uv: { u: number; v: number }
}

export interface RoadMaterialPixels {
	readonly width: number
	readonly height: number
	readonly data: Uint8ClampedArray
}

export interface RoadPixelContribution {
	readonly color: readonly [number, number, number]
	readonly alpha: number
}

export function blendRoadPixel(
	contributions: readonly RoadPixelContribution[]
): readonly [number, number, number, number] {
	let alphaSum = 0
	let red = 0
	let green = 0
	let blue = 0
	for (const contribution of contributions) {
		const alpha = Math.max(0, contribution.alpha)
		if (alpha <= 0) continue
		alphaSum += alpha
		red += contribution.color[0] * alpha
		green += contribution.color[1] * alpha
		blue += contribution.color[2] * alpha
	}
	if (alphaSum <= 0) return [0, 0, 0, 0]
	return [
		Math.round(red / alphaSum),
		Math.round(green / alphaSum),
		Math.round(blue / alphaSum),
		Math.round(Math.min(1, alphaSum) * 255),
	]
}

export function roadMaterialSeedUv(borderCoord: AxialCoord): { u: number; v: number } {
	const q = Math.round(borderCoord.q * 2048)
	const r = Math.round(borderCoord.r * 2048)
	const a = hash01(q, r, 0x2c1b3c6d)
	const b = hash01(q, r, 0x7f4a7c15)
	return { u: a, v: b }
}

function hash01(q: number, r: number, salt: number): number {
	let n = (q * 374761393 + r * 668265263 + salt) | 0
	n = (n ^ (n >>> 13)) | 0
	n = Math.imul(n, 1274126177)
	return ((n ^ (n >>> 16)) >>> 0) / 0x100000000
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
	return t * t * (3 - 2 * t)
}

function capsuleAlpha(
	point: { x: number; y: number },
	end: { x: number; y: number },
	type: RoadType
): number {
	const len2 = end.x * end.x + end.y * end.y
	if (len2 <= 0) return 0
	const t = Math.max(0, Math.min(1, (point.x * end.x + point.y * end.y) / len2))
	const closest = { x: end.x * t, y: end.y * t }
	const dx = point.x - closest.x
	const dy = point.y - closest.y
	const distance = Math.sqrt(dx * dx + dy * dy)
	const radius = roadPathWidth(type) / 2
	const edgeFade = roadEdgeFade(type)
	return 1 - smoothstep(radius - edgeFade, radius, distance)
}

function sampleMaterial(
	material: RoadMaterialPixels,
	contribution: RoadContribution,
	point: { x: number; y: number }
): readonly [number, number, number] {
	const length = Math.max(1, Math.hypot(contribution.end.x, contribution.end.y))
	const axisX = contribution.end.x / length
	const axisY = contribution.end.y / length
	const along = point.x * axisX + point.y * axisY
	const across = -point.x * axisY + point.y * axisX
	const materialWorldSize = roadMaterialWorldSize(contribution.type)
	const u = wrap01(contribution.uv.u + along / materialWorldSize)
	const v = wrap01(contribution.uv.v + across / materialWorldSize)
	const x = Math.floor(u * material.width) % material.width
	const y = Math.floor(v * material.height) % material.height
	const offset = (y * material.width + x) * 4
	return [
		material.data[offset] ?? 0,
		material.data[offset + 1] ?? 0,
		material.data[offset + 2] ?? 0,
	]
}

function wrap01(value: number): number {
	return ((value % 1) + 1) % 1
}

function materialPixelsFromTexture(texture: Texture): RoadMaterialPixels | undefined {
	const source = texture.source as unknown as { resource?: CanvasImageSource }
	const resource = source.resource
	if (!resource || typeof document === 'undefined') return undefined
	const canvas = document.createElement('canvas')
	canvas.width = Math.max(1, Math.round(texture.width))
	canvas.height = Math.max(1, Math.round(texture.height))
	const context = canvas.getContext('2d', { willReadFrequently: true })
	if (!context) return undefined
	context.drawImage(resource, 0, 0, canvas.width, canvas.height)
	const image = context.getImageData(0, 0, canvas.width, canvas.height)
	return { width: canvas.width, height: canvas.height, data: image.data }
}

function fallbackRoadMaterial(type: RoadType): RoadMaterialPixels {
	const data = new Uint8ClampedArray(4)
	const [red, green, blue] = roadFallbackRgb(type)
	data[0] = red
	data[1] = green
	data[2] = blue
	data[3] = 255
	return { width: 1, height: 1, data }
}

function collectTileRoadContributions(
	renderer: PixiGameRenderer,
	coord: AxialCoord
): RoadContribution[] {
	const contributions: RoadContribution[] = []
	const hex = renderer.game.hex
	if (!hex) return contributions
	const center = cartesian(coord, tileSize)
	for (const side of hexSides) {
		const neighbor = axial.linear(coord, side)
		const borderCoord = axial.linear([0.5, coord], [0.5, neighbor])
		const roadType = hex.getRoadType(borderCoord)
		if (!roadType) continue
		const neighborWorld = cartesian(neighbor, tileSize)
		contributions.push({
			borderCoord,
			type: roadType,
			end: {
				x: (neighborWorld.x - center.x) / 2,
				y: (neighborWorld.y - center.y) / 2,
			},
			uv: roadMaterialSeedUv(borderCoord),
		})
	}
	return contributions
}

function roadTileTexturePixelsForContributions(contributions: readonly RoadContribution[]): number {
	return Math.max(...contributions.map((contribution) => roadTileTexturePixels(contribution.type)))
}

function roadTileWorldSizeForContributions(contributions: readonly RoadContribution[]): number {
	return Math.max(...contributions.map((contribution) => roadTileWorldSize(contribution.type)))
}

export class RoadTileTextureCache {
	private readonly textures = new Map<string, Texture>()
	private readonly textureWorldSizes = new Map<string, number>()
	private readonly warnedMissingTextureWorldSize = new Set<string>()
	private readonly materialPixels = new Map<RoadType, RoadMaterialPixels>()

	constructor(private readonly renderer: PixiGameRenderer) {}

	invalidate(coords: readonly AxialCoord[]): void {
		for (const coord of coords) {
			const key = axial.key(coord)
			const texture = this.textures.get(key)
			this.textures.delete(key)
			this.textureWorldSizes.delete(key)
			this.warnedMissingTextureWorldSize.delete(key)
			if (texture && texture !== Texture.WHITE) texture.destroy(true)
		}
	}

	clear(): void {
		for (const texture of this.textures.values()) {
			if (texture !== Texture.WHITE) texture.destroy(true)
		}
		this.textures.clear()
		this.textureWorldSizes.clear()
		this.warnedMissingTextureWorldSize.clear()
	}

	getTileTexture(coord: AxialCoord): Texture | undefined {
		const key = axial.key(coord)
		const cached = this.textures.get(key)
		if (cached) return cached
		const contributions = collectTileRoadContributions(this.renderer, coord)
		if (contributions.length === 0) return undefined
		const texture = this.createTexture(contributions)
		this.textures.set(key, texture)
		this.textureWorldSizes.set(key, roadTileWorldSizeForContributions(contributions))
		return texture
	}

	createSprite(coord: AxialCoord, displayBounds: Rectangle): Sprite | undefined {
		const key = axial.key(coord)
		const texture = this.getTileTexture(coord)
		if (!texture) return undefined
		const worldSize = this.textureWorldSizes.get(key)
		if (worldSize === undefined) {
			if (!this.warnedMissingTextureWorldSize.has(key)) {
				console.warn(`[road-tile-texture] missing cached world size for ${key}; using path default`)
				this.warnedMissingTextureWorldSize.add(key)
			}
		}
		const spriteWorldSize = worldSize ?? roadTileWorldSize('path')
		const center = cartesian(coord, tileSize)
		const sprite = setPixiName(new Sprite(texture), `terrain.road:${axial.key(coord)}`)
		sprite.eventMode = 'none'
		sprite.position.set(
			center.x - spriteWorldSize / 2 - displayBounds.x,
			center.y - spriteWorldSize / 2 - displayBounds.y
		)
		sprite.width = spriteWorldSize
		sprite.height = spriteWorldSize
		return sprite
	}

	private createTexture(contributions: readonly RoadContribution[]): Texture {
		if (typeof document === 'undefined') return Texture.WHITE
		const tileTexturePixels = roadTileTexturePixelsForContributions(contributions)
		const tileWorldSize = roadTileWorldSizeForContributions(contributions)
		const canvas = document.createElement('canvas')
		canvas.width = tileTexturePixels
		canvas.height = tileTexturePixels
		const context = canvas.getContext('2d')
		if (!context) return Texture.WHITE
		const image = context.createImageData(canvas.width, canvas.height)
		for (let y = 0; y < canvas.height; y++) {
			for (let x = 0; x < canvas.width; x++) {
				const point = {
					x: (x / (canvas.width - 1) - 0.5) * tileWorldSize,
					y: (y / (canvas.height - 1) - 0.5) * tileWorldSize,
				}
				const pixels: RoadPixelContribution[] = []
				for (const contribution of contributions) {
					const alpha = capsuleAlpha(point, contribution.end, contribution.type)
					if (alpha <= 0) continue
					const material = this.getMaterialPixels(contribution.type)
					pixels.push({ alpha, color: sampleMaterial(material, contribution, point) })
				}
				const [red, green, blue, alpha] = blendRoadPixel(pixels)
				const offset = (y * canvas.width + x) * 4
				image.data[offset] = red
				image.data[offset + 1] = green
				image.data[offset + 2] = blue
				image.data[offset + 3] = alpha
			}
		}
		context.putImageData(image, 0, 0)
		return Texture.from(canvas)
	}

	private getMaterialPixels(type: RoadType): RoadMaterialPixels {
		const cached = this.materialPixels.get(type)
		if (cached) return cached
		const texture = this.renderer.getTexture(roadMaterialSpec(type))
		const material = materialPixelsFromTexture(texture) ?? fallbackRoadMaterial(type)
		this.materialPixels.set(type, material)
		return material
	}
}
