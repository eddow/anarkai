import { Container, Geometry, GlProgram, Graphics, Mesh, Rectangle, Shader, Texture, UniformGroup } from 'pixi.js'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { axial, cartesian, hexSides, type AxialCoord } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import { terrainTextureSpec } from './terrain-visual-helpers'

const TRIANGLE_DIRECTIONS: readonly [AxialCoord, AxialCoord][] = [
	[{ q: 1, r: 0 }, { q: 1, r: -1 }],
	[{ q: 1, r: -1 }, { q: 0, r: -1 }],
	[{ q: 0, r: -1 }, { q: -1, r: 0 }],
	[{ q: -1, r: 0 }, { q: -1, r: 1 }],
	[{ q: -1, r: 1 }, { q: 0, r: 1 }],
	[{ q: 0, r: 1 }, { q: 1, r: 0 }],
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

export function collectRenderableTriangles(input: SectorTerrainBakeInput): CollectedRenderableTriangles {
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

function buildRiverOverlay(input: SectorTerrainBakeInput): Graphics | undefined {
	const debug = inspectRiverOverlay(input)
	if (debug.riverBranchCount === 0) return undefined

	const overlay = setPixiName(
		new Graphics(),
		`terrain.continuous:${input.sectorKey}:rivers`
	)
	overlay.eventMode = 'none'

	for (const coord of input.bakeTileCoords) {
		const sample = input.terrainTiles.get(axial.key(coord))
		const edgeEntries = sample?.hydrology?.edges ? Object.entries(sample.hydrology.edges) : []
		if (edgeEntries.length === 0) continue

		const center = cartesian(coord, tileSize)
		const localCenterX = center.x - input.displayBounds.x
		const localCenterY = center.y - input.displayBounds.y
		const riverHalfWidth = maxRiverHalfWidth(edgeEntries.map(([, edge]) => edge?.width ?? 0))

		for (const [directionKey, edge] of edgeEntries) {
			if (!edge) continue
			const direction = Number(directionKey) as keyof typeof hexSides
			const side = hexSides[direction]
			if (!side) continue

			const midpoint = cartesian(
				{
					q: coord.q + side.q * 0.5,
					r: coord.r + side.r * 0.5,
				},
				tileSize
			)
			const localMidpointX = midpoint.x - input.displayBounds.x
			const localMidpointY = midpoint.y - input.displayBounds.y
			const branchWidth = riverStrokeWidth(edge.width)

			overlay
				.moveTo(localCenterX, localCenterY)
				.lineTo(localMidpointX, localMidpointY)
				.stroke({
					width: branchWidth + 2,
					color: 0x6b5a3e,
					alpha: 0.72,
					cap: 'round',
					join: 'round',
				})
			overlay
				.moveTo(localCenterX, localCenterY)
				.lineTo(localMidpointX, localMidpointY)
				.stroke({
					width: Math.max(2, branchWidth),
					color: 0x4ea6d8,
					alpha: 0.9,
					cap: 'round',
					join: 'round',
				})
		}

		if (edgeEntries.length >= 2) {
			overlay.circle(localCenterX, localCenterY, riverHalfWidth + 1).fill({
				color: 0x6b5a3e,
				alpha: 0.68,
			})
			overlay.circle(localCenterX, localCenterY, Math.max(2, riverHalfWidth)).fill({
				color: 0x4ea6d8,
				alpha: 0.9,
			})
		}
	}

	return overlay
}

function riverStrokeWidth(edgeWidth: number): number {
	return Math.max(tileSize * 0.16, Math.min(tileSize * 0.46, edgeWidth * 1.9))
}

function maxRiverHalfWidth(widths: number[]): number {
	if (widths.length === 0) return tileSize * 0.08
	return Math.max(...widths.map((width) => riverStrokeWidth(width) / 2))
}
