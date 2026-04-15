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
import type { RenderableTerrainTile } from 'ssh/game/game'
import { type AxialCoord, axial, cartesian, hexSides } from 'ssh/utils'

const HEX_SIDES = hexSides as unknown as readonly [
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
]

import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import {
	buildRiverTileNode,
	computeRiverBakeMonotoneHalfOuterMap,
	halfDrageaSampledFillPolygonWorld,
	type RiverHalfDragea,
	type RiverTileNode,
	tileKeyForCoord,
} from './river-quarter-model'
import { terrainTextureSpec } from './terrain-visual-helpers'

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

		for (const triangle of collectRenderableTriangles(input).triangles) {
			const mesh = this.createTriangleMesh(triangle, input.displayBounds)
			if (mesh) bakeContainer.addChild(mesh)
		}
		const riverOverlay = buildRiverOverlay(input)
		if (riverOverlay) bakeContainer.addChild(riverOverlay)
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
		const collected = collectRenderableTriangles(input)
		const rivers = inspectRiverOverlay(input)
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

interface RiverOverlayDebug {
	riverTileCount: number
	riverBranchCount: number
	riverJunctionCount: number
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

function shouldSuppressWaterRiverTerminal(
	coord: AxialCoord,
	sample: RenderableTerrainTile | undefined,
	directions: readonly number[],
	terrainTiles: Map<string, RenderableTerrainTile>
): boolean {
	if (sample?.terrain !== 'water' || directions.length !== 1) return false
	const upstreamDirection = directions[0]
	if (upstreamDirection === undefined) return false
	const upstreamCoord = {
		q: coord.q + HEX_SIDES[upstreamDirection]!.q,
		r: coord.r + HEX_SIDES[upstreamDirection]!.r,
	}
	const upstreamSample = terrainTiles.get(axial.key(upstreamCoord))
	const upstreamDirections = upstreamSample?.hydrology?.edges
		? Object.keys(upstreamSample.hydrology.edges)
				.map(Number)
				.filter((d) => Number.isInteger(d) && d >= 0 && d <= 5)
		: []
	if (upstreamSample?.terrain === 'water' || upstreamDirections.length !== 2) return false
	return upstreamDirections.some((direction) => {
		const neighbor = terrainTiles.get(
			axial.key({
				q: upstreamCoord.q + HEX_SIDES[direction]!.q,
				r: upstreamCoord.r + HEX_SIDES[direction]!.r,
			})
		)
		return neighbor?.terrain === 'water'
	})
}

function drawRiverQuarterModelForTile(
	graphics: Graphics,
	node: RiverTileNode,
	displayBounds: Rectangle
): void {
	const bx = displayBounds.x
	const by = displayBounds.y
	const local = (p: { x: number; y: number }) => ({ x: p.x - bx, y: p.y - by })

	const fillAlphaForHalf = (half: RiverHalfDragea): number => {
		const mouthLip =
			half.leftQuarter.terminalRole === 'mouthLip' || half.rightQuarter.terminalRole === 'mouthLip'
		if (mouthLip && half.terminalCap === 'open') return 0.28
		if (half.terminalCap === 'fanned') return 0.44
		return 0.52
	}

	for (const branch of node.branches) {
		for (const half of branch.halfDrageas) {
			const wedge = halfDrageaSampledFillPolygonWorld(half).map(local)
			graphics.poly(wedge).fill({ color: 0x4ea6d8, alpha: fillAlphaForHalf(half) })
		}
		for (const half of branch.halfDrageas) {
			for (const quarter of [half.leftQuarter, half.rightQuarter]) {
				const [p0, p1, p2] = quarter.bankCurve
				const a = local(p0)
				const b = local(p1)
				const c = local(p2)
				graphics
					.moveTo(a.x, a.y)
					.quadraticCurveTo(b.x, b.y, c.x, c.y)
					.stroke({ width: 2.5, color: 0x6b5a3e, alpha: 0.85, cap: 'round', join: 'round' })
			}
		}
	}
}

function buildRiverOverlay(input: SectorTerrainBakeInput): Container | undefined {
	const debug = inspectRiverOverlay(input)
	const lakeComponents = collectInlandLakeTileComponents(input.bakeTileCoords, input.terrainTiles)
	const drewLake = lakeComponents.length > 0
	if (debug.riverBranchCount === 0 && !drewLake) return undefined

	const bakeKeySet = new Set(input.bakeTileCoords.map((c) => axial.key(c)))
	const widthMap = computeRiverBakeMonotoneHalfOuterMap(
		input.bakeTileCoords,
		tileSize,
		input.terrainTiles
	)

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

	const graphics = setPixiName(
		new Graphics(),
		`terrain.continuous:${input.sectorKey}:rivers:quarters`
	)
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

		const suppressed = shouldSuppressWaterRiverTerminal(
			coord,
			sample,
			directions,
			input.terrainTiles
		)

		const node = buildRiverTileNode({
			tileKey: tileKeyForCoord(coord),
			coord,
			tileSize,
			terrain: sample?.terrain,
			hydrologyEdges: edges,
			riverFlow: sample?.hydrology?.riverFlow,
			tileHalfOuterFromBake: widthMap.get(axial.key(coord)),
			neighborTerrain: (direction) => {
				const side = HEX_SIDES[direction]
				if (!side) return undefined
				return input.terrainTiles.get(axial.key({ q: coord.q + side.q, r: coord.r + side.r }))
					?.terrain
			},
			suppressed,
		})

		if (node.suppressed || node.branches.length === 0) continue

		drawRiverQuarterModelForTile(graphics, node, input.displayBounds)
		drew = true
	}

	if (drew) {
		root.addChild(graphics)
	} else {
		graphics.destroy()
	}

	return root.children.length > 0 ? root : undefined
}
