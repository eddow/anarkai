/**
 * Main generation system entry point
 * Coordinates all generation activities for the game
 */

import {
	boardAmbientGoodsMaxPerType,
	boardDefaultTileWalkTime,
	boardDepositFillDivisor,
	boardDepositFillRandomSpread,
	boardGoodsEquilibriumVariance,
	boardInfiniteHalfLifeEquilibriumMultiplier,
	deposits,
	goods as goodsCatalog,
} from 'engine-rules'
import {
	type BiomeHint,
	generateMacroHydrologyWasm,
	generateHydratedRegion as generateTerrainRegion,
	generateHydratedRegionAsync as generateTerrainRegionAsync,
	generateSectorRegionAsync as generateTerrainSectorRegionAsync,
	type TerrainMacroHydrologySnapshot,
	type TerrainSectorCoord,
	type TileOverride,
} from 'engine-terrain'
import type { DepositType, GoodType, TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { hexSides } from 'ssh/utils'
import type { GeneratedSettlement, SettlementKind } from './settlements'
import {
	defaultNameTheme,
	generateName,
	type NameThemeId,
} from './names'
import { profile } from '../dev/debug'
import {
	BoardGenerator,
	type GeneratedDepositData,
	resolveHydrologyForTile,
	resolveTerrainForTile,
} from './board'
import type { GeneratedTileData } from './board'

export interface GameGenerationConfig {
	terrainSeed: number
	characterCount: number
	characterRadius?: number
	nameTheme?: NameThemeId
}

export interface TerrainTerraformPatch {
	coord: [number, number]
	height?: number
	temperature?: number
	humidity?: number
	sediment?: number
	waterTable?: number
	terrain?: TerrainType
}

const terrainToBiome: Partial<Record<TerrainType, BiomeHint>> = {
	water: 'lake',
	sand: 'sand',
	grass: 'grass',
	forest: 'forest',
	rocky: 'rocky',
	snow: 'snow',
}

function beginGenerationProfile(label: string, payload?: unknown): (payload?: unknown) => void {
	return profile.terrainGeneration.begin?.(label, payload) ?? (() => {})
}

function toTileOverrides(terraforming: TerrainTerraformPatch[]): TileOverride[] {
	const overrides: TileOverride[] = []
	for (const patch of terraforming) {
		const tilePatch: TileOverride['tile'] = {}
		if (patch.height !== undefined) tilePatch.height = patch.height
		if (patch.temperature !== undefined) tilePatch.temperature = patch.temperature
		if (patch.humidity !== undefined) tilePatch.humidity = patch.humidity
		if (patch.sediment !== undefined) tilePatch.sediment = patch.sediment
		if (patch.waterTable !== undefined) tilePatch.waterTable = patch.waterTable

		overrides.push({
			coord: { q: patch.coord[0], r: patch.coord[1] },
			tile: Object.keys(tilePatch).length > 0 ? tilePatch : undefined,
			biome: patch.terrain ? terrainToBiome[patch.terrain] : undefined,
		})
	}
	return overrides
}

// ---------------------------------------------------------------------------
// WASM <-> Game type mapping
// ---------------------------------------------------------------------------

/**
 * Map game TerrainType to WASM terrain kind index.
 *
 * WASM terrain kinds:
 *   0 = water, 1 = grass, 2 = forest, 3 = sand, 4 = rocky, 5 = snow, 6 = concrete
 * Engine-rules terrain types:
 *   water, forest, rocky, grass, concrete, sand, snow
 */
function toWasmTerrainKind(terrain: TerrainType): number {
	switch (terrain) {
		case 'water': return 0
		case 'forest': return 2
		case 'rocky': return 4
		case 'grass': return 1
		case 'sand': return 3
		case 'snow': return 5
		case 'concrete': return 6
		default: return 1 // fallback to plains
	}
}

/**
 * Map WASM deposit kind code (u8) to game DepositType or null.
 *
 * WASM deposit codes: 0=none, 1=stone, 2=iron, 3=gold, 4=wood, 5=berry_bush
 * Game deposit types:  'berry_bush', 'rock', 'tree'
 *
 * All WASM mineral deposits (stone/iron/gold) map to 'rock' since the
 * game catalog does not distinguish iron or gold as deposit types.
 * Wood deposits map to 'tree'.
 */
const WASM_DEPOSIT_TO_GAME: Record<number, DepositType | null> = {
	0: null, // none
	1: 'rock', // stone
	2: 'rock', // iron
	3: 'rock', // gold
	4: 'tree', // wood
	5: 'berry_bush',
}

/**
 * Map WASM good kind code (u8) to game GoodType or null.
 *
 * WASM good codes:
 *   0=wood, 1=stone, 2=iron, 3=gold, 4=berries, 5=mushrooms, 6=fish
 * Game good types:
 *   'berries', 'mushrooms', 'planks', 'stone', 'wood'
 *
 * Iron, gold, and fish have no direct game equivalents and are skipped.
 */
const WASM_GOOD_TO_GAME: Record<number, GoodType | null> = {
	0: 'wood', // wood
	1: 'stone', // stone
	2: null, // iron — no game equivalent
	3: null, // gold — no game equivalent
	4: 'berries', // berries
	5: 'mushrooms', // mushrooms
	6: null, // fish — no game equivalent
}

// ---------------------------------------------------------------------------
// WASM packed result parser
// ---------------------------------------------------------------------------

/**
 * Packed WASM board result format per tile:
 *   bytes 0-3:   coord.q (i32, little-endian)
 *   bytes 4-7:   coord.r (i32, little-endian)
 *   byte  8:     deposit_kind (0=none, 1=stone, 2=iron, 3=gold, 4=wood, 5=berry_bush)
 *   byte  9:     goods_count
 *   bytes 10+:  goods (1 byte each, see WASM_GOOD_TO_GAME)
 */
const WASM_TILE_HEADER_SIZE = 10 // 4+4+1+1 bytes per tile header

/**
 * Parse the packed Uint8Array from `wasm_generate_board` into a map of
 * coord key → { deposit: DepositType | null, goods: GoodType[] }.
 */
function parseWasmBoardResult(
	packed: Uint8Array,
): Map<string, { deposit: DepositType | null; goods: GoodType[] }> {
	const result = new Map<string, { deposit: DepositType | null; goods: GoodType[] }>()
	const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength)
	let offset = 0

	while (offset + WASM_TILE_HEADER_SIZE <= packed.length) {
		const q = dv.getInt32(offset, true)
		const r = dv.getInt32(offset + 4, true)
		const depositCode = packed[offset + 8]!
		const goodsCount = packed[offset + 9]!

		const deposit = WASM_DEPOSIT_TO_GAME[depositCode] ?? null
		const goods: GoodType[] = []

		for (let i = 0; i < goodsCount; i++) {
			const goodCode = packed[offset + 10 + i]!
			const goodType = WASM_GOOD_TO_GAME[goodCode]
			if (goodType) {
				goods.push(goodType)
			}
		}

		const key = `${q},${r}`
		result.set(key, { deposit, goods })

		offset += WASM_TILE_HEADER_SIZE + goodsCount
	}

	return result
}

// ---------------------------------------------------------------------------
// Amount computation (mirrors BoardGenerator logic from board.ts)
// ---------------------------------------------------------------------------

/**
 * Simple deterministic PRNG — same algorithm as BoardGenerator.
 */
function simpleRng(seed: string): () => number {
	let state = hashString(seed)
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296
		return state / 4294967296
	}
}

function hashString(str: string): number {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash
	}
	return Math.abs(hash)
}

/**
 * Compute deposit amount from engine-rules deposit definition.
 * Mirrors BoardGenerator.generateRandomDeposit().
 */
function computeDepositAmount(depositType: DepositType, coordKey: string): number {
	const depositDef = deposits[depositType as keyof typeof deposits]
	if (!depositDef) return 0

	// Use per-tile seed so different tiles with the same deposit type get
	// different amounts — matches the per-coordinate behaviour of BoardGenerator.
	const rnd = simpleRng(`deposit-amount-${depositType}-${coordKey}`)
	return Math.floor(
		((1 + rnd() * boardDepositFillRandomSpread) * (depositDef.maxAmount ?? 18)) /
			boardDepositFillDivisor,
	)
}

/**
 * Compute goods amounts for a tile, mirroring BoardGenerator.generateRandomGoods().
 */
function computeGoodsAmounts(
	terrain: TerrainType,
	deposit: GeneratedDepositData | undefined,
): Record<string, number> {
	const goods: Record<string, number> = {}

	// Deposit-driven goods
	if (deposit) {
		const depositDef = deposits[deposit.type as keyof typeof deposits]
		if (depositDef && 'generation' in depositDef && depositDef.generation) {
			for (const [goodType, generationRate] of Object.entries(depositDef.generation)) {
				const goodDef = goodsCatalog[goodType as keyof typeof goodsCatalog]
				if (!goodDef) continue

				const totalGenerationRate = (generationRate as number) * deposit.amount
				let equilibriumAmount: number

				if (goodDef.halfLife === Infinity) {
					equilibriumAmount = totalGenerationRate * boardInfiniteHalfLifeEquilibriumMultiplier
				} else {
					const decayRate = 1 - 2 ** (-1 / goodDef.halfLife)
					equilibriumAmount = totalGenerationRate / decayRate
				}

				const variance = boardGoodsEquilibriumVariance
				const rnd = simpleRng(`goods-${goodType}-${deposit.type}`)
				const randomFactor = 1 + (rnd() - 0.5) * variance
				const finalAmount = Math.max(0, Math.floor(equilibriumAmount * randomFactor))

				if (finalAmount > 0) {
					goods[goodType] = finalAmount
				}
			}
		}
	}

	// Ambient goods from terrain
	const terrainDef = terrainAmbientGoods(terrain)
	if (terrainDef) {
		for (const [goodType, _chance] of Object.entries(terrainDef)) {
			const rnd = simpleRng(`ambient-${goodType}`)
			const ambientAmount = Math.floor(rnd() * boardAmbientGoodsMaxPerType)
			if (ambientAmount > 0) {
				goods[goodType] = (goods[goodType] || 0) + ambientAmount
			}
		}
	}

	return goods
}

/** Ambient goods per terrain type (mirrors engine-rules terrain.generation.goods). */
function terrainAmbientGoods(terrain: TerrainType): Record<string, number> | null {
	switch (terrain) {
		case 'forest':
			return { mushrooms: 0.3 }
		case 'sand':
			return { berries: 0.05 }
		default:
			return null
	}
}

// ---------------------------------------------------------------------------
// GameGenerator
// ---------------------------------------------------------------------------

type TerrainSnapshot = Awaited<ReturnType<typeof generateTerrainRegionAsync>>

/**
 * Cache for resolved terrain types to avoid duplicate resolveTerrainForTile calls.
 */
interface TileEntry {
	key: string
	q: number
	r: number
	biome: BiomeHint
	tileField: Parameters<typeof resolveTerrainForTile>[1]
	terrain: TerrainType
}

export class GameGenerator {
	/**
	 * Generate board data synchronously.
	 * Uses TypeScript BoardGenerator (WASM init is async).
	 */
	generateRegion(
		config: GameGenerationConfig,
		coords: Iterable<AxialCoord>,
		terraforming: TerrainTerraformPatch[] = [],
	): GeneratedTileData[] {
		const snapshot = generateTerrainRegion(config.terrainSeed, coords, {
			tileOverrides: toTileOverrides(terraforming),
		})

		const boardGenerator = new BoardGenerator()
		return boardGenerator.generateBoard(snapshot)
	}

	/**
	 * Collect tile entries from a snapshot, resolving terrain once per tile.
	 */
	private resolveTileEntries(snapshot: TerrainSnapshot): TileEntry[] {
		const entries: TileEntry[] = []
		for (const [key, tileField] of snapshot.tiles) {
			const biome = snapshot.biomes.get(key)
			if (!biome) continue

			const parts = key.split(',')
			const q = Number(parts[0]!)
			const r = Number(parts[1]!)
			const terrain = resolveTerrainForTile(
				biome,
				tileField as Parameters<typeof resolveTerrainForTile>[1],
			)

			entries.push({ key, q, r, biome, tileField: tileField as Parameters<typeof resolveTerrainForTile>[1], terrain })
		}
		return entries
	}

	/**
	 * Generate board data from a terrain snapshot using the WASM core for
	 * deposit/goods type determination, with TypeScript computing amounts.
	 *
	 * This is the primary integration point between the Rust/WASM generation
	 * engine and the TypeScript game types.
	 *
	 * @param seed - Terrain seed for deterministic WASM deposit/goods generation
	 * @param snapshot - The terrain snapshot from engine-terrain
	 */
	async generateBoard(seed: number, snapshot: TerrainSnapshot): Promise<GeneratedTileData[]> {
		console.info('[save-load][generation.generateBoard] begin', {
			seed,
			snapshotTiles: snapshot.tiles.size,
			hasHydrology: snapshot.hydrology.channels.size > 0,
		})
		const entries = this.resolveTileEntries(snapshot)
		const tileCount = entries.length

		if (tileCount === 0) {
			console.info('[save-load][generation.generateBoard] empty')
			return []
		}

		// Build coordinate and terrain kind arrays for the WASM call
		const coords = new Int32Array(tileCount * 2)
		const terrainKinds = new Uint8Array(tileCount)

		for (let i = 0; i < tileCount; i++) {
			const entry = entries[i]!
			coords[i * 2] = entry.q
			coords[i * 2 + 1] = entry.r
			terrainKinds[i] = toWasmTerrainKind(entry.terrain)
		}

		// Call WASM for deposit/goods type determination
		const { wasm_generate_board } = await import('anarkai-core')
		const packed = wasm_generate_board(seed, coords, terrainKinds)

		// Parse WASM result
		const wasmResults = parseWasmBoardResult(packed)

		// Build final tiles
		const tiles: GeneratedTileData[] = []
		for (const entry of entries) {
			const tileField = snapshot.tiles.get(entry.key)!
			const hydrology = resolveHydrologyForTile(snapshot, entry.key, { q: entry.q, r: entry.r })
			const wasmTile = wasmResults.get(entry.key)

			let deposit: GeneratedDepositData | undefined
			if (wasmTile?.deposit) {
				deposit = {
					type: wasmTile.deposit,
					amount: computeDepositAmount(wasmTile.deposit, entry.key),
				}
			}

			const goods = computeGoodsAmounts(entry.terrain, deposit)

			tiles.push({
				coord: { q: entry.q, r: entry.r },
				terrain: entry.terrain,
				height: tileField.height,
				hydrology,
				deposit,
				goods,
				walkTime: boardDefaultTileWalkTime,
			})
		}

		console.info('[save-load][generation.generateBoard] done', {
			tiles: tiles.length,
			deposits: tiles.filter((t) => !!t.deposit).length,
		})
		return tiles
	}

	async generateRegionAsync(
		config: GameGenerationConfig,
		coords: Iterable<AxialCoord>,
		terraforming: TerrainTerraformPatch[] = [],
	): Promise<GeneratedTileData[]> {
		const coordList = [...coords]
		console.info('[save-load][generation.generateRegionAsync] begin', {
			seed: config.terrainSeed,
			coords: coordList.length,
			terraforming: terraforming.length,
		})
		const snapshot = await generateTerrainRegionAsync(config.terrainSeed, coordList, {
			fieldBackend: 'auto',
			tileOverrides: toTileOverrides(terraforming),
		})
		const generated = await this.generateBoard(config.terrainSeed, snapshot)
		console.info('[save-load][generation.generateRegionAsync] done', {
			tiles: generated.length,
		})
		return generated
	}

	async generateSectorsAsync(
		config: GameGenerationConfig,
		sectors: Iterable<TerrainSectorCoord>,
		terraforming: TerrainTerraformPatch[] = [],
		options: { includeHydrology?: boolean } = {},
	): Promise<GeneratedTileData[]> {
		const sectorList = [...sectors]
		const endProfile = beginGenerationProfile('generateSectorsAsync', {
			sectors: sectorList.length,
			includeHydrology: options.includeHydrology ?? true,
		})
		const snapshot = await generateTerrainSectorRegionAsync(config.terrainSeed, sectorList, {
			fieldBackend: 'wasm',
			sectorStep: 17,
			padding: 1,
			hydrologyPadding: 24,
			includeHydrology: options.includeHydrology ?? true,
			tileOverrides: toTileOverrides(terraforming),
		})

		const generated = await this.generateBoard(config.terrainSeed, snapshot)
		endProfile({
			sectors: sectorList.length,
			tiles: generated.length,
			snapshotTiles: snapshot.tiles.size,
			edges: snapshot.edges.size,
			channels: snapshot.hydrology.channels.size,
		})
		return generated
	}

	async generateMacroHydrologyAsync(
		config: GameGenerationConfig,
		centerSector: TerrainSectorCoord,
		options: { macroStep?: number; sectorRadius?: number } = {},
	): Promise<TerrainMacroHydrologySnapshot> {
		const macroStep = options.macroStep ?? 8
		const sectorRadius = options.sectorRadius ?? 12
		const endProfile = beginGenerationProfile('generateMacroHydrologyAsync', {
			centerSector,
			sectorRadius,
			macroStep,
		})
		const snapshot = generateMacroHydrologyWasm(config.terrainSeed, centerSector, {
			sectorRadius,
			sectorStep: 17,
			macroStep,
		})
		endProfile({
			macroTiles: snapshot.macroTileCount,
			riverSegments: snapshot.riverSegmentCount,
			wasmMs: snapshot.timings.wasmMs,
			unpackMs: snapshot.timings.unpackMs,
			totalMs: snapshot.timings.totalMs,
		})
		return snapshot
	}

	/**
		* Place settlements on generated tiles using the WASM settlement engine.
		*
		* The WASM function `wasm_place_settlements` is exported from `anarkai-core`
		* and uses the pure-Rust `place_settlements()` from `generation::settlements`.
		*
		* @param seed          Deterministic seed for settlement placement
		* @param tiles         Board tiles with terrain & hydrology data
		* @param config        Settlement count and minimum spacing
		* @returns Sorted list of placed settlements (highest score first)
		*/
	async placeSettlements(
		seed: number,
		tiles: GeneratedTileData[],
		config: { settlementCount: number; minSpacing: number; nameTheme?: NameThemeId }
	): Promise<{ settlements: GeneratedSettlement[]; coords: Int32Array; terrainKinds: Uint8Array; hasRiver: Uint8Array }> {
		if (tiles.length === 0 || config.settlementCount === 0) return { settlements: [], coords: new Int32Array(0), terrainKinds: new Uint8Array(0), hasRiver: new Uint8Array(0) }

		const tileCount = tiles.length

		// Build coordinate and terrain-kind arrays for the WASM call
		const coords = new Int32Array(tileCount * 2)
		const terrainKinds = new Uint8Array(tileCount)
		const hasWaterAccess = new Uint8Array(tileCount)
		const hasRiver = new Uint8Array(tileCount)

		// Build a quick lookup for water neighbours
		const tileMap = new Map<string, GeneratedTileData>()
		for (const tile of tiles) {
			tileMap.set(`${tile.coord.q},${tile.coord.r}`, tile)
		}

		for (let i = 0; i < tileCount; i++) {
			const tile = tiles[i]!
			coords[i * 2] = tile.coord.q
			coords[i * 2 + 1] = tile.coord.r
			terrainKinds[i] = toWasmTerrainKind(tile.terrain)

			// Water access: any neighbouring tile is water
			let waterAccess = 0
			for (const side of hexSides) {
				const nKey = `${tile.coord.q + side.q},${tile.coord.r + side.r}`
				const neighbour = tileMap.get(nKey)
				if (neighbour && neighbour.terrain === 'water') {
					waterAccess = 1
					break
				}
			}
			hasWaterAccess[i] = waterAccess

			// River: tile has hydrology with channel or edges
			hasRiver[i] =
				tile.hydrology?.isChannel ||
				(tile.hydrology?.bankInfluence ?? 0) > 0 ||
				Object.keys(tile.hydrology?.edges ?? {}).length > 0
					? 1
					: 0
		}

		// Propagate river to neighbours so tiles adjacent to rivers
		// also receive the river bonus — settlements should be placed
		// near water features, not directly on them.
		for (let i = 0; i < tileCount; i++) {
			if (hasRiver[i] !== 1) continue
			const tile = tiles[i]!
			for (const side of hexSides) {
				const nKey = `${tile.coord.q + side.q},${tile.coord.r + side.r}`
				const nIndex = tileMap.get(nKey)
				if (nIndex === undefined) continue
				// Find the index of this neighbour in the tiles array
				const ni = tiles.findIndex(
					(t) => t.coord.q === tile.coord.q + side.q && t.coord.r === tile.coord.r + side.r,
				)
				if (ni >= 0) hasRiver[ni] = 1
			}
		}

		// Call WASM for settlement placement
		const { wasm_place_settlements } = await import('anarkai-core')
		const packed = wasm_place_settlements(
			seed,
			config.settlementCount,
			coords,
			terrainKinds,
			hasWaterAccess,
			hasRiver,
			config.minSpacing,
		)

		// Parse packed result: [q, r, kind, score*100, ...]
		const settlements: GeneratedSettlement[] = []
		for (let i = 0; i + 3 < packed.length; i += 4) {
			const q = packed[i]!
			const r = packed[i + 1]!
			const kindCode = packed[i + 2]!
			const score = (packed[i + 3]! / 100)

			const kind: SettlementKind =
				kindCode === 2 ? 'city' : kindCode === 1 ? 'town' : 'village'
			const radius = kind === 'city' ? 4 : kind === 'town' ? 3 : 2

			const id = `settlement-${q},${r}`
			settlements.push({
				id,
				name: generateName({
					seed,
					theme: config.nameTheme ?? defaultNameTheme,
					kind: 'settlement',
					key: id,
					level: kind,
				}),
				kind,
				center: { q, r },
				score,
				radius,
			})
		}

		return { settlements, coords, terrainKinds, hasRiver }
	}
	/**
	 * Generate character positions on the board using the WASM population engine.
	 *
	 * The WASM function `wasm_generate_character_positions` is exported from
	 * `anarkai-core` and uses the pure-Rust `generate_character_positions()`
	 * from `generation::population`.
	 *
	 * @param seed       Deterministic seed for character placement
	 * @param boardData  Board tiles with terrain & coordinate data
	 * @param config     Character count, placement radius, and origin
	 * @returns Array of character data with names and coordinates
	 */
	async generateCharacters(
		seed: number,
		boardData: GeneratedTileData[],
		config: { characterCount: number; radius?: number; origin: AxialCoord; nameTheme?: NameThemeId }
	): Promise<GeneratedCharacterData[]> {
		if (boardData.length === 0 || config.characterCount <= 0) return []

		const tileCount = boardData.length

		// Build coordinate and terrain kind arrays for the WASM call
		const coords = new Int32Array(tileCount * 2)
		const terrainKinds = new Uint8Array(tileCount)

		for (let i = 0; i < tileCount; i++) {
			const tile = boardData[i]!
			coords[i * 2] = tile.coord.q
			coords[i * 2 + 1] = tile.coord.r
			terrainKinds[i] = toWasmTerrainKind(tile.terrain)
		}

		const radius = config.radius ?? 0
		const maxRadius = radius > 0 ? radius : Math.max(10, Math.ceil(Math.sqrt(tileCount) / 2))

		// Call WASM for character position generation
		const { wasm_generate_character_positions } = await import('anarkai-core')
		const packed = wasm_generate_character_positions(
			seed,
			config.characterCount,
			coords,
			terrainKinds,
			new Int32Array([1, maxRadius]), // min_radius=1 (exclude origin), max_radius
			new Int32Array([config.origin.q, config.origin.r]),
		)

		// Parse packed result: [q, r, q, r, ...]
		const characters: GeneratedCharacterData[] = []
		for (let i = 0; i + 1 < packed.length; i += 2) {
			const q = packed[i]!
			const r = packed[i + 1]!
			const index = i / 2
			characters.push({
				name: generateName({
					seed,
					theme: config.nameTheme ?? defaultNameTheme,
					kind: 'character',
					key: `character-${index}:${q},${r}`,
				}),
				coord: { q, r },
			})
		}

		return characters
	}
}

/** Data for a single generated character. */
export interface GeneratedCharacterData {
	name: string
	coord: AxialCoord
}

export { BoardGenerator, type GeneratedTileData } from './board'
export {
	defaultNameTheme,
	generateName,
	listNameThemes,
	type NameKind,
	type NameThemeId,
} from './names'
export {
	type GeneratedSettlement,
	type SettlementRegion,
	type SettlementRegionNode,
	type SettlementRegionSet,
	type SettlementRegionSetPlan,
	generateSettlementRegionSetPlan,
	generateZonePlanForSettlements,
	type SettlementKind,
	type SettlementZonePlan,
} from './settlements'
