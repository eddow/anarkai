import type { Texture } from 'pixi.js'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { TerrainSample } from 'ssh/game/terrain-provider'
import type { AxialCoord } from 'ssh/utils'
import { LCG, subSeed } from 'ssh/utils/numbers'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { deposits as visualDeposits } from '../../assets/visual-content'
import type { PixiGameRenderer } from '../renderer'

export interface StaticResourceSpriteSpec {
	textureKey: string
	x: number
	y: number
	scale: number
}

export function buildStaticResourceSpriteSpecs(
	content: UnBuiltLand,
	resolveTexture: (spec: string) => Texture | undefined
): StaticResourceSpriteSpec[] {
	const deposit = content.deposit
	if (!deposit || deposit.amount <= 0) return []

	const tileCoord = toAxialCoord(content.tile.position)!
	const depositName =
		deposit.name ||
		(deposit.constructor as { resourceName?: string; key?: string }).resourceName ||
		(deposit.constructor as { resourceName?: string; key?: string }).key
	return buildStaticResourceSpriteSpecsForCoord(
		tileCoord,
		{
			name: depositName,
			amount: deposit.amount,
			maxAmount: (deposit as any).maxAmount,
		},
		resolveTexture
	)
}

export function buildStaticResourceSpriteSpecsFromTerrainSample(
	coord: AxialCoord,
	sample: TerrainSample,
	resolveTexture: (spec: string) => Texture | undefined
): StaticResourceSpriteSpec[] {
	if (!sample.deposit || sample.deposit.amount <= 0) return []
	return buildStaticResourceSpriteSpecsForCoord(
		coord,
		{
			name: sample.deposit.name || sample.deposit.type,
			amount: sample.deposit.amount,
			maxAmount: sample.deposit.maxAmount,
		},
		resolveTexture
	)
}

function buildStaticResourceSpriteSpecsForCoord(
	tileCoord: AxialCoord,
	deposit: { name?: string; amount: number; maxAmount?: number },
	resolveTexture: (spec: string) => Texture | undefined
): StaticResourceSpriteSpec[] {
	const visibleCount = Math.max(1, Math.floor(deposit.amount))
	const stableSlotCount = Math.max(1, Math.floor(deposit.maxAmount ?? visibleCount))
	const areaScale = Math.max(2 / Math.sqrt(stableSlotCount), 0.5)
	const tileWorld = toWorldCoord(tileCoord)
	const def = deposit.name ? visualDeposits[deposit.name] : undefined
	if (!def?.sprites?.length) return []

	const specs: StaticResourceSpriteSpec[] = []
	for (let i = 0; i < visibleCount; i++) {
		const seed = subSeed('deposit-unit', tileCoord.q, tileCoord.r, i)
		const rnd = LCG('gameSeed', seed)
		const spriteIndex = Math.floor(rnd() * def.sprites.length)
		const textureKey = def.sprites[spriteIndex]
		const texture = resolveTexture(textureKey)
		if (!texture) continue

		const base = Math.max(texture.width, texture.height) / tileSize
		const scale = (1 / Math.max(base, 1e-6)) * areaScale * 0.7
		const u = rnd() * 2 - 1
		const v = rnd() * 2 - 1
		const absU = Math.abs(u)
		const absV = Math.abs(v)
		const s = absU + absV
		const qOff = ((u * 0.4) / Math.max(s, 1e-10)) * Math.min(s, 1)
		const rOff = ((v * 0.4) / Math.max(s, 1e-10)) * Math.min(s, 1)
		const offsetWorld = toWorldCoord({ q: qOff, r: rOff })

		specs.push({
			textureKey,
			x: tileWorld.x + offsetWorld.x,
			y: tileWorld.y + offsetWorld.y,
			scale,
		})
	}
	return specs
}

export function resolveUsableTexture(
	renderer: Pick<PixiGameRenderer, 'getTexture'>,
	spec: string
): Texture | undefined {
	const texture = renderer.getTexture(spec)
	if (!texture) return undefined
	const frame = texture.frame
	if (!frame || frame.width <= 0 || frame.height <= 0) return undefined
	return texture
}
