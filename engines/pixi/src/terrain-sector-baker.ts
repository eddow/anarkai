import {
	Container,
	Geometry,
	GlProgram,
	Graphics,
	Mesh,
	Rectangle,
	Shader,
	Texture,
	UniformGroup,
} from 'pixi.js'
import type { RoadSegment } from 'ssh/board/roads'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { type AxialCoord, axial, cartesian, hexSides } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import type { RoadTileTextureCache } from './road-tile-texture'
import { terrainTextureSpec } from './terrain-visual-helpers'

const HEX_SIDES = hexSides as unknown as readonly [
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
]

export type TerrainLodMode =
	| 'detail'
	| 'texture'
	| 'overview-fine'
	| 'overview-medium'
	| 'overview-coarse'
	| 'overview-distant'
	| 'macro'
	| 'material'

const TRIANGLE_DIRECTIONS: readonly [AxialCoord, AxialCoord][] = [
	[
		{ q: 1, r: 0 },
		{ q: 1, r: -1 },
	],
	[
		{ q: 1, r: -1 },
		{ q: 0, r: -1 },
	],
	[
		{ q: 0, r: -1 },
		{ q: -1, r: 0 },
	],
	[
		{ q: -1, r: 0 },
		{ q: -1, r: 1 },
	],
	[
		{ q: -1, r: 1 },
		{ q: 0, r: 1 },
	],
	[
		{ q: 0, r: 1 },
		{ q: 1, r: 0 },
	],
]

export interface SectorTerrainBakeInput {
	sectorKey: string
	displayBounds: Rectangle
	interiorTileCoords: AxialCoord[]
	bakeTileCoords: AxialCoord[]
	terrainTiles: Map<string, RenderableTerrainTile>
	lodMode?: TerrainLodMode
	includeRivers?: boolean
	roadTileTextures?: RoadTileTextureCache
	roadLineSegments?: readonly RoadSegment[]
}

export interface SectorTerrainBakeDebug {
	sectorKey: string
	interiorTileCount: number
	bakeTileCount: number
	terrainTileCount: number
	totalTriangleCandidates: number
	trianglesAfterBoundsCull: number
	trianglesMissingTextures: number
	meshesCreated: number
	riverTileCount: number
	riverBranchCount: number
	riverJunctionCount: number
	generatedZoneTileCount: number
	roadTileCount: number
	lodMode: TerrainLodMode
	bakeMode: 'textured' | 'material'
	displayBounds: {
		x: number
		y: number
		width: number
		height: number
	}
}

const BARYCENTRIC_VERTEX_SHADER = `
		in vec2 aPosition;
		in vec3 aBarycentric;

		out vec4 vColor;
		out vec3 vBarycentric;
		out vec2 vWorldPosition;

		uniform mat3 uProjectionMatrix;
		uniform mat3 uWorldTransformMatrix;
		uniform vec4 uWorldColorAlpha;
		uniform vec2 uResolution;
		uniform mat3 uTransformMatrix;
		uniform vec4 uColor;
		uniform float uRound;

		vec2 roundPixels(vec2 position, vec2 targetSize)
		{
			return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
		}

		void main(void) {
			mat3 modelMatrix = uTransformMatrix;
			vec2 position = aPosition;

			vColor = vec4(1.0) * uColor * uWorldColorAlpha;
			vBarycentric = aBarycentric;
			vWorldPosition = position;

			mat3 modelViewProjectionMatrix = uProjectionMatrix * uWorldTransformMatrix * modelMatrix;
			gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);

			if (uRound == 1.0) {
				gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
			}
		}
	`

const BARYCENTRIC_FRAGMENT_SHADER = `
		in vec4 vColor;
		in vec3 vBarycentric;
		in vec2 vWorldPosition;

		out vec4 finalColor;

		uniform sampler2D uTextureA;
		uniform sampler2D uTextureB;
		uniform sampler2D uTextureC;
		uniform vec2 uTextureSizeA;
		uniform vec2 uTextureSizeB;
		uniform vec2 uTextureSizeC;

		void main(void) {
			vec2 uvA = fract(vWorldPosition / max(uTextureSizeA, vec2(1.0)));
			vec2 uvB = fract(vWorldPosition / max(uTextureSizeB, vec2(1.0)));
			vec2 uvC = fract(vWorldPosition / max(uTextureSizeC, vec2(1.0)));

			vec4 sampleA = texture(uTextureA, uvA);
			vec4 sampleB = texture(uTextureB, uvB);
			vec4 sampleC = texture(uTextureC, uvC);
			vec4 outColor = sampleA * vBarycentric.x + sampleB * vBarycentric.y + sampleC * vBarycentric.z;

			finalColor = outColor * vColor;
		}
	`

let sharedBaryBlendProgram: GlProgram | undefined

function getSharedBaryBlendProgram(): GlProgram | undefined {
	if (sharedBaryBlendProgram) return sharedBaryBlendProgram
	if (typeof document === 'undefined') return undefined
	sharedBaryBlendProgram = GlProgram.from({
		name: 'anarkai-barycentric-sector-bake',
		vertex: BARYCENTRIC_VERTEX_SHADER,
		fragment: BARYCENTRIC_FRAGMENT_SHADER,
	})
	return sharedBaryBlendProgram
}

export class SectorTerrainBaker {
	constructor(private readonly renderer: PixiGameRenderer) {}

	public bake(input: SectorTerrainBakeInput): {
		texture: Texture | undefined
		debug: SectorTerrainBakeDebug
	} {
		const appRenderer = this.renderer.app?.renderer
		const debug = this.inspect(input)
		if (!appRenderer) return { texture: undefined, debug }
		if (typeof document === 'undefined') return { texture: Texture.WHITE, debug }

		const bakeContainer = setPixiName(
			new Container({ label: `terrain.continuous:${input.sectorKey}:bake` }),
			`terrain.continuous:${input.sectorKey}:bake`
		)
		bakeContainer.eventMode = 'none'

		if (isMaterialLod(input.lodMode)) {
			const material = buildMaterialTerrainOverlay(input)
			if (material) bakeContainer.addChild(material)
		} else {
			for (const triangle of collectRenderableTriangles(input).triangles) {
				const mesh = this.createTriangleMesh(triangle, input.displayBounds)
				if (mesh) bakeContainer.addChild(mesh)
			}
		}
		const riverOverlay = input.includeRivers === false ? undefined : buildRiverOverlay(input)
		if (riverOverlay) bakeContainer.addChild(riverOverlay)
		const generatedZoneOverlay = buildGeneratedZoneOverlay(input)
		if (generatedZoneOverlay) bakeContainer.addChild(generatedZoneOverlay)
		let roadTileCount = 0
		if (input.roadTileTextures) {
			for (const coord of input.bakeTileCoords) {
				const sprite = input.roadTileTextures.createSprite(coord, input.displayBounds)
				if (!sprite) continue
				bakeContainer.addChild(sprite)
				roadTileCount++
			}
		} else if (input.roadLineSegments?.length) {
			const roadOverlay = buildRoadLineOverlay(input)
			if (roadOverlay) {
				bakeContainer.addChild(roadOverlay.graphics)
				roadTileCount = roadOverlay.count
			}
		}
		debug.roadTileCount = roadTileCount
		debug.meshesCreated = bakeContainer.children.length

		const generatedTexture = appRenderer.textureGenerator.generateTexture({
			target: bakeContainer,
			frame: new Rectangle(0, 0, input.displayBounds.width, input.displayBounds.height),
			resolution: 1,
			antialias: true,
		})
		bakeContainer.destroy({ children: true })
		return { texture: generatedTexture, debug }
	}

	public inspect(input: SectorTerrainBakeInput): SectorTerrainBakeDebug {
		const materialLod = isMaterialLod(input.lodMode)
		const collected = materialLod
			? { totalTriangleCandidates: 0, triangles: [] }
			: collectRenderableTriangles(input)
		const rivers =
			input.includeRivers === false ? emptyRiverOverlayDebug() : inspectRiverOverlay(input)
		let trianglesMissingTextures = 0
		for (const triangle of collected.triangles) {
			if (resolveTriangleTextures(this.renderer, triangle).some((texture) => !texture)) {
				trianglesMissingTextures++
			}
		}

		return {
			sectorKey: input.sectorKey,
			interiorTileCount: input.interiorTileCoords.length,
			bakeTileCount: input.bakeTileCoords.length,
			terrainTileCount: input.terrainTiles.size,
			totalTriangleCandidates: collected.totalTriangleCandidates,
			trianglesAfterBoundsCull: collected.triangles.length,
			trianglesMissingTextures,
			meshesCreated: 0,
			riverTileCount: rivers.riverTileCount,
			riverBranchCount: rivers.riverBranchCount,
			riverJunctionCount: rivers.riverJunctionCount,
			generatedZoneTileCount: countGeneratedZoneTiles(input),
			roadTileCount: countRoadLineSegments(input),
			lodMode: input.lodMode ?? 'detail',
			bakeMode: materialLod ? 'material' : 'textured',
			displayBounds: {
				x: input.displayBounds.x,
				y: input.displayBounds.y,
				width: input.displayBounds.width,
				height: input.displayBounds.height,
			},
		}
	}

	private createTriangleMesh(
		triangle: RenderTriangle,
		displayBounds: Rectangle
	): Mesh<any, Shader> | undefined {
		const textures = resolveTriangleTextures(this.renderer, triangle)
		if (textures.some((texture) => !texture)) return undefined
		const program = getSharedBaryBlendProgram()
		if (!program) return undefined

		const positions = new Float32Array(
			triangle.tiles.flatMap(({ coord }) => {
				const world = cartesian(coord, tileSize)
				return [world.x - displayBounds.x, world.y - displayBounds.y]
			})
		)

		const barycentric = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
		const geometry = new Geometry({
			attributes: {
				aPosition: { buffer: positions, size: 2 },
				aBarycentric: { buffer: barycentric, size: 3 },
			},
		})

		const [textureA, textureB, textureC] = textures as [Texture, Texture, Texture]
		const terrainBakeUniforms = new UniformGroup({
			uTextureSizeA: { value: toTextureSize(textureA), type: 'vec2<f32>' },
			uTextureSizeB: { value: toTextureSize(textureB), type: 'vec2<f32>' },
			uTextureSizeC: { value: toTextureSize(textureC), type: 'vec2<f32>' },
		})
		const shader = new Shader({
			glProgram: program,
			resources: {
				uTextureA: textureA.source,
				uTextureB: textureB.source,
				uTextureC: textureC.source,
				terrainBakeUniforms,
			},
		})

		const mesh = setPixiName(
			new Mesh({
				geometry,
				shader,
				texture: textureA,
			}),
			`terrain.triangle:${triangle.key}`
		)
		mesh.eventMode = 'none'
		mesh.roundPixels = false
		return mesh
	}
}

function isMaterialLod(lodMode: TerrainLodMode | undefined): boolean {
	return (
		lodMode === 'material' ||
		lodMode === 'overview-fine' ||
		lodMode === 'overview-medium' ||
		lodMode === 'overview-coarse' ||
		lodMode === 'overview-distant' ||
		lodMode === 'macro'
	)
}

interface RenderTriangle {
	key: string
	tiles: Array<{ coord: AxialCoord; terrainTile: RenderableTerrainTile }>
}

export interface CollectedRenderableTriangles {
	totalTriangleCandidates: number
	triangles: RenderTriangle[]
}

export function collectRenderableTriangles(
	input: SectorTerrainBakeInput
): CollectedRenderableTriangles {
	let totalTriangleCandidates = 0
	const triangles = new Map<string, RenderTriangle>()
	const displayBounds = input.displayBounds

	for (const coord of input.bakeTileCoords) {
		for (const [leftDirection, rightDirection] of TRIANGLE_DIRECTIONS) {
			totalTriangleCandidates++
			const a = coord
			const b = { q: coord.q + leftDirection.q, r: coord.r + leftDirection.r }
			const c = { q: coord.q + rightDirection.q, r: coord.r + rightDirection.r }
			const keys = [a, b, c].map((tile) => axial.key(tile))
			const terrainTiles = keys.map((key) => input.terrainTiles.get(key))
			if (terrainTiles.some((tile) => !tile)) continue

			const worldPositions = [a, b, c].map((tile) => cartesian(tile, tileSize))
			const triangleBounds = boundsForWorldPositions(worldPositions)
			if (!displayBounds.intersects(triangleBounds)) continue

			const triangleKey = [...keys].sort().join('|')
			if (triangles.has(triangleKey)) continue
			triangles.set(triangleKey, {
				key: triangleKey,
				tiles: [
					{ coord: a, terrainTile: terrainTiles[0]! },
					{ coord: b, terrainTile: terrainTiles[1]! },
					{ coord: c, terrainTile: terrainTiles[2]! },
				],
			})
		}
	}

	return {
		totalTriangleCandidates,
		triangles: [...triangles.values()],
	}
}

function boundsForWorldPositions(points: Array<{ x: number; y: number }>): Rectangle {
	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY

	for (const point of points) {
		minX = Math.min(minX, point.x)
		minY = Math.min(minY, point.y)
		maxX = Math.max(maxX, point.x)
		maxY = Math.max(maxY, point.y)
	}

	return new Rectangle(minX, minY, maxX - minX, maxY - minY)
}

function resolveTriangleTextures(
	renderer: PixiGameRenderer,
	triangle: RenderTriangle
): Array<Texture | undefined> {
	return triangle.tiles.map(({ terrainTile }) => {
		const textureKey = terrainTextureSpec(terrainTile.terrain, 'grass')
		return resolveBakeTexture(renderer, textureKey)
	})
}

function toTextureSize(texture: Texture): [number, number] {
	return [Math.max(1, texture.width), Math.max(1, texture.height)]
}

function resolveBakeTexture(renderer: PixiGameRenderer, textureKey: string): Texture | undefined {
	const texture = renderer.getTexture(textureKey)
	if (!texture) return undefined
	return texture
}

function hexPolygonLocal(
	coord: AxialCoord,
	displayBounds: Rectangle
): Array<{ x: number; y: number }> {
	const center = cartesian(coord, tileSize)
	return Array.from({ length: 6 }, (_, index) => {
		const angle = (Math.PI / 3) * (index + 0.5)
		return {
			x: center.x + Math.cos(angle) * tileSize - displayBounds.x,
			y: center.y + Math.sin(angle) * tileSize - displayBounds.y,
		}
	})
}

function materialColorForTile(tile: RenderableTerrainTile): number {
	switch (tile.terrain) {
		case 'water':
			return 0x3d84aa
		case 'sand':
			return 0xc8b36d
		case 'forest':
			return 0x2f6f3d
		case 'rocky':
			return 0x7d7f78
		case 'snow':
			return 0xe0e8ed
		case 'concrete':
			return 0x8d918d
		case 'grass':
		default: {
			const height = Math.max(-1, Math.min(1, tile.height ?? 0))
			if (height > 0.22) return 0x5f7f42
			if (height < -0.08) return 0x5c8c55
			return 0x477f3f
		}
	}
}

function buildMaterialTerrainOverlay(input: SectorTerrainBakeInput): Graphics | undefined {
	const graphics = setPixiName(
		new Graphics(),
		`terrain.continuous:${input.sectorKey}:material-ground`
	)
	graphics.eventMode = 'none'
	let drew = false
	for (const coord of input.interiorTileCoords) {
		const tile = input.terrainTiles.get(axial.key(coord))
		if (!tile) continue
		graphics
			.poly(hexPolygonLocal(coord, input.displayBounds))
			.fill({ color: materialColorForTile(tile), alpha: 1 })
		drew = true
	}
	if (drew) return graphics
	graphics.destroy()
	return undefined
}

function fallbackZoneColor(zoneId: string): number {
	let hash = 2166136261
	for (let i = 0; i < zoneId.length; i++) {
		hash ^= zoneId.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return 0x555555 ^ (hash & 0x2f2f2f)
}

function parseZoneColor(color: string | undefined, zoneId: string): number {
	if (!color) return fallbackZoneColor(zoneId)
	const trimmed = color.trim()
	const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallbackZoneColor(zoneId)
	return Number.parseInt(hex, 16)
}

function countGeneratedZoneTiles(input: SectorTerrainBakeInput): number {
	let count = 0
	for (const coord of input.bakeTileCoords) {
		const tile = input.terrainTiles.get(axial.key(coord))
		if (tile?.zone?.generated) count++
	}
	return count
}

function buildGeneratedZoneOverlay(input: SectorTerrainBakeInput): Graphics | undefined {
	const graphics = setPixiName(
		new Graphics(),
		`terrain.continuous:${input.sectorKey}:generated-zones`
	)
	graphics.eventMode = 'none'
	let drew = false
	for (const coord of input.bakeTileCoords) {
		const tile = input.terrainTiles.get(axial.key(coord))
		if (!tile?.zone?.generated) continue
		graphics
			.poly(hexPolygonLocal(coord, input.displayBounds))
			.fill({ color: parseZoneColor(tile.zone.color, tile.zone.id), alpha: 0.26 })
		drew = true
	}
	if (drew) return graphics
	graphics.destroy()
	return undefined
}

interface RoadLineEndpointPair {
	from: AxialCoord
	to: AxialCoord
}

function roadLineEndpoints(segment: RoadSegment): RoadLineEndpointPair {
	const q = segment.coord.q
	const r = segment.coord.r
	return {
		from: { q: Math.ceil(q), r: Math.floor(r) },
		to: { q: Math.floor(q), r: Math.ceil(r) },
	}
}

function roadLineIntersectsDisplay(segment: RoadSegment, displayBounds: Rectangle): boolean {
	const endpoints = roadLineEndpoints(segment)
	const from = cartesian(endpoints.from, tileSize)
	const to = cartesian(endpoints.to, tileSize)
	const minX = Math.min(from.x, to.x)
	const minY = Math.min(from.y, to.y)
	const maxX = Math.max(from.x, to.x)
	const maxY = Math.max(from.y, to.y)
	const padding = tileSize * 0.25
	return displayBounds.intersects(
		new Rectangle(
			minX - padding,
			minY - padding,
			Math.max(1, maxX - minX + padding * 2),
			Math.max(1, maxY - minY + padding * 2)
		)
	)
}

function countRoadLineSegments(input: SectorTerrainBakeInput): number {
	if (input.roadTileTextures || !input.roadLineSegments) return 0
	let count = 0
	for (const segment of input.roadLineSegments) {
		if (roadLineIntersectsDisplay(segment, input.displayBounds)) count++
	}
	return count
}

function buildRoadLineOverlay(
	input: SectorTerrainBakeInput
): { graphics: Graphics; count: number } | undefined {
	if (!input.roadLineSegments?.length) return undefined
	const graphics = setPixiName(new Graphics(), `terrain.continuous:${input.sectorKey}:roads:lines`)
	graphics.eventMode = 'none'
	let count = 0
	for (const segment of input.roadLineSegments) {
		if (!roadLineIntersectsDisplay(segment, input.displayBounds)) continue
		const endpoints = roadLineEndpoints(segment)
		const from = cartesian(endpoints.from, tileSize)
		const to = cartesian(endpoints.to, tileSize)
		graphics
			.moveTo(from.x - input.displayBounds.x, from.y - input.displayBounds.y)
			.lineTo(to.x - input.displayBounds.x, to.y - input.displayBounds.y)
			.stroke({ width: 5, color: 0x9b7048, alpha: 0.82, cap: 'round', join: 'round' })
		count++
	}
	if (count > 0) return { graphics, count }
	graphics.destroy()
	return undefined
}

interface RiverOverlayDebug {
	riverTileCount: number
	riverBranchCount: number
	riverJunctionCount: number
}

function emptyRiverOverlayDebug(): RiverOverlayDebug {
	return {
		riverTileCount: 0,
		riverBranchCount: 0,
		riverJunctionCount: 0,
	}
}

function inspectRiverOverlay(input: SectorTerrainBakeInput): RiverOverlayDebug {
	let riverTileCount = 0
	let riverBranchCount = 0
	let riverJunctionCount = 0

	for (const coord of input.bakeTileCoords) {
		const sample = input.terrainTiles.get(axial.key(coord))
		const edgeEntries = sample?.hydrology?.edges ? Object.entries(sample.hydrology.edges) : []
		if (edgeEntries.length === 0) continue
		riverTileCount++
		riverBranchCount += edgeEntries.length
		if (edgeEntries.length >= 2) riverJunctionCount++
	}

	return {
		riverTileCount,
		riverBranchCount,
		riverJunctionCount,
	}
}

/** Group adjacent `inlandTerminal` hydrology tiles in the bake domain for pooled lake fill. */
export function collectInlandLakeTileComponents(
	bakeTileCoords: readonly AxialCoord[],
	terrainTiles: Map<string, RenderableTerrainTile>
): AxialCoord[][] {
	const keySet = new Set(bakeTileCoords.map((c) => axial.key(c)))
	const isInlandLakeTile = (coord: AxialCoord): boolean => {
		const sample = terrainTiles.get(axial.key(coord))
		if (sample === undefined || sample.terrain === 'water') return false
		return sample.hydrology?.riverFlow?.tileRole === 'inlandTerminal'
	}
	const visited = new Set<string>()
	const components: AxialCoord[][] = []
	for (const start of bakeTileCoords) {
		if (!isInlandLakeTile(start)) continue
		const startKey = axial.key(start)
		if (visited.has(startKey)) continue
		const stack: AxialCoord[] = [start]
		const comp: AxialCoord[] = []
		visited.add(startKey)
		while (stack.length > 0) {
			const c = stack.pop()!
			comp.push(c)
			for (let d = 0; d < 6; d += 1) {
				const side = HEX_SIDES[d]
				if (!side) continue
				const n = { q: c.q + side.q, r: c.r + side.r }
				const nk = axial.key(n)
				if (!keySet.has(nk) || visited.has(nk)) continue
				if (!isInlandLakeTile(n)) continue
				visited.add(nk)
				stack.push(n)
			}
		}
		if (comp.length > 0) components.push(comp)
	}
	return components
}

interface LakeHullPoint {
	readonly x: number
	readonly y: number
}

function convexHullMonotoneChain(points: readonly LakeHullPoint[]): LakeHullPoint[] {
	if (points.length <= 2) return [...points]
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
	const cross = (o: LakeHullPoint, a: LakeHullPoint, b: LakeHullPoint) =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
	const lower: LakeHullPoint[] = []
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
			lower.pop()
		}
		lower.push(p)
	}
	const upper: LakeHullPoint[] = []
	for (let i = sorted.length - 1; i >= 0; i -= 1) {
		const p = sorted[i]!
		while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
			upper.pop()
		}
		upper.push(p)
	}
	lower.pop()
	upper.pop()
	return [...lower, ...upper]
}

function centroidOfHull(hull: readonly LakeHullPoint[]): LakeHullPoint {
	let x = 0
	let y = 0
	for (const p of hull) {
		x += p.x
		y += p.y
	}
	const n = hull.length
	return { x: x / n, y: y / n }
}

function inflateHullOutward(
	hull: readonly LakeHullPoint[],
	origin: LakeHullPoint,
	factor: number
): LakeHullPoint[] {
	return hull.map((p) => ({
		x: origin.x + (p.x - origin.x) * factor,
		y: origin.y + (p.y - origin.y) * factor,
	}))
}

const INLAND_HULL_INFLATE_FACTOR = 1.3
const SINGLE_INLAND_BASIN_MAJOR = 0.58
const SINGLE_INLAND_BASIN_MINOR = 0.4
const SINGLE_INLAND_BASIN_CENTER_NUDGE = 0.16
const SINGLE_INLAND_BASIN_SEGMENTS = 22

function normalize2d(x: number, y: number): { x: number; y: number } {
	const len = Math.hypot(x, y)
	if (len < 1e-9) return { x: 0, y: 0 }
	return { x: x / len, y: y / len }
}

/**
 * Bake-local polygon for one inland-terminal basin (rotated ellipse along upstream).
 * Exported for unit tests.
 */
export function singleInlandTerminalBasinPolygonLocal(
	coord: AxialCoord,
	displayBounds: Rectangle,
	terrainTiles: Map<string, RenderableTerrainTile>
): readonly { readonly x: number; readonly y: number }[] {
	const sample = terrainTiles.get(axial.key(coord))
	if (!sample) return []
	const bx = displayBounds.x
	const by = displayBounds.y

	const centerWorld = cartesian(coord, tileSize)
	const upstream = sample.hydrology?.riverFlow?.upstreamDirections?.[0]
	let inward: { x: number; y: number }
	if (upstream !== undefined && HEX_SIDES[upstream]) {
		const side = HEX_SIDES[upstream]!
		const edgeMidWorld = cartesian(
			{ q: coord.q + side.q * 0.5, r: coord.r + side.r * 0.5 },
			tileSize
		)
		inward = normalize2d(centerWorld.x - edgeMidWorld.x, centerWorld.y - edgeMidWorld.y)
	} else {
		inward = { x: 0, y: 1 }
	}

	const poolCenterWorld = {
		x: centerWorld.x + inward.x * tileSize * SINGLE_INLAND_BASIN_CENTER_NUDGE,
		y: centerWorld.y + inward.y * tileSize * SINGLE_INLAND_BASIN_CENTER_NUDGE,
	}
	const phi = Math.atan2(inward.y, inward.x)
	const cosP = Math.cos(phi)
	const sinP = Math.sin(phi)
	const a = tileSize * SINGLE_INLAND_BASIN_MAJOR
	const b = tileSize * SINGLE_INLAND_BASIN_MINOR
	const cx = poolCenterWorld.x - bx
	const cy = poolCenterWorld.y - by
	const poly: { x: number; y: number }[] = []
	for (let i = 0; i < SINGLE_INLAND_BASIN_SEGMENTS; i += 1) {
		const t = (i / SINGLE_INLAND_BASIN_SEGMENTS) * Math.PI * 2
		const ct = Math.cos(t)
		const st = Math.sin(t)
		const wx = a * ct
		const wy = b * st
		poly.push({
			x: cx + wx * cosP - wy * sinP,
			y: cy + wx * sinP + wy * cosP,
		})
	}
	return poly
}

function drawSingleInlandTerminalBasin(
	graphics: Graphics,
	coord: AxialCoord,
	displayBounds: Rectangle,
	terrainTiles: Map<string, RenderableTerrainTile>
): void {
	const poly = singleInlandTerminalBasinPolygonLocal(coord, displayBounds, terrainTiles)
	if (poly.length === 0) return
	graphics.poly(poly.map((p) => ({ x: p.x, y: p.y }))).fill({ color: 0x4ea6d8, alpha: 0.5 })
}

function expandInlandLakeComponentWithShoreWater(
	comp: readonly AxialCoord[],
	bakeKeySet: ReadonlySet<string>,
	terrainTiles: Map<string, RenderableTerrainTile>
): AxialCoord[] {
	const seen = new Set<string>(comp.map((c) => axial.key(c)))
	const out: AxialCoord[] = [...comp]
	for (const c of comp) {
		for (let d = 0; d < 6; d += 1) {
			const side = HEX_SIDES[d]
			if (!side) continue
			const n = { q: c.q + side.q, r: c.r + side.r }
			const nk = axial.key(n)
			if (!bakeKeySet.has(nk) || seen.has(nk)) continue
			const sample = terrainTiles.get(nk)
			if (sample?.terrain !== 'water') continue
			seen.add(nk)
			out.push(n)
		}
	}
	return out
}

function drawInlandLakeRegions(
	graphics: Graphics,
	components: readonly (readonly AxialCoord[])[],
	displayBounds: Rectangle,
	terrainTiles: Map<string, RenderableTerrainTile>,
	bakeKeySet: ReadonlySet<string>
): void {
	const bx = displayBounds.x
	const by = displayBounds.y
	for (const comp of components) {
		if (comp.length === 1) {
			drawSingleInlandTerminalBasin(graphics, comp[0]!, displayBounds, terrainTiles)
			continue
		}
		const expanded = expandInlandLakeComponentWithShoreWater(comp, bakeKeySet, terrainTiles)
		const world = expanded.map((coord) => cartesian(coord, tileSize))
		const hull = convexHullMonotoneChain(world)
		if (hull.length < 3) {
			for (const coord of expanded) {
				const w = cartesian(coord, tileSize)
				graphics.circle(w.x - bx, w.y - by, tileSize * 0.36).fill({ color: 0x4ea6d8, alpha: 0.42 })
			}
			continue
		}
		const c = centroidOfHull(hull)
		const inflated = inflateHullOutward(hull, c, INLAND_HULL_INFLATE_FACTOR)
		const local = inflated.map((p) => ({ x: p.x - bx, y: p.y - by }))
		graphics.poly(local).fill({ color: 0x4ea6d8, alpha: 0.44 })
	}
}

function drawSimpleRiverLineForTile(
	graphics: Graphics,
	coord: AxialCoord,
	directions: readonly number[],
	displayBounds: Rectangle
): boolean {
	const center = cartesian(coord, tileSize)
	const localCenter = {
		x: center.x - displayBounds.x,
		y: center.y - displayBounds.y,
	}
	let drew = false

	for (const direction of directions) {
		const side = HEX_SIDES[direction]
		if (!side) continue
		const edgeMidpoint = cartesian(
			{
				q: coord.q + side.q * 0.5,
				r: coord.r + side.r * 0.5,
			},
			tileSize
		)
		graphics
			.moveTo(localCenter.x, localCenter.y)
			.lineTo(edgeMidpoint.x - displayBounds.x, edgeMidpoint.y - displayBounds.y)
			.stroke({ width: 4, color: 0x2f8fd8, alpha: 0.9, cap: 'round', join: 'round' })
		drew = true
	}

	return drew
}

function buildRiverOverlay(input: SectorTerrainBakeInput): Container | undefined {
	const debug = inspectRiverOverlay(input)
	const lakeComponents = collectInlandLakeTileComponents(input.bakeTileCoords, input.terrainTiles)
	const drewLake = lakeComponents.length > 0
	if (debug.riverBranchCount === 0 && !drewLake) return undefined

	const bakeKeySet = new Set(input.bakeTileCoords.map((c) => axial.key(c)))

	const root = setPixiName(
		new Container({ label: `terrain.continuous:${input.sectorKey}:rivers` }),
		`terrain.continuous:${input.sectorKey}:rivers`
	)
	root.eventMode = 'none'

	if (drewLake) {
		const lakeGraphics = setPixiName(
			new Graphics(),
			`terrain.continuous:${input.sectorKey}:rivers:inland-lakes`
		)
		lakeGraphics.eventMode = 'none'
		drawInlandLakeRegions(
			lakeGraphics,
			lakeComponents,
			input.displayBounds,
			input.terrainTiles,
			bakeKeySet
		)
		root.addChild(lakeGraphics)
	}

	if (debug.riverBranchCount === 0) {
		return root
	}

	const graphics = setPixiName(new Graphics(), `terrain.continuous:${input.sectorKey}:rivers:lines`)
	graphics.eventMode = 'none'
	let drew = false

	for (const coord of input.bakeTileCoords) {
		const sample = input.terrainTiles.get(axial.key(coord))
		const edges = sample?.hydrology?.edges
		if (!edges || Object.keys(edges).length === 0) continue

		const directions = Object.keys(edges)
			.map(Number)
			.filter((d) => Number.isInteger(d) && d >= 0 && d <= 5)
		if (directions.length === 0) continue

		if (drawSimpleRiverLineForTile(graphics, coord, directions, input.displayBounds)) drew = true
	}

	if (drew) {
		root.addChild(graphics)
	} else {
		graphics.destroy()
	}

	return root.children.length > 0 ? root : undefined
}
