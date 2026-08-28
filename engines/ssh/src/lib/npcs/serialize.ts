import { unwrap } from 'mutts'
import {
	type ExecutionContext,
	reviveExecutionState,
	type StateValueHook,
	serializeExecutionState,
} from 'npc-script'
import { TileContent } from 'ssh/board/content/content'
import { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game/game'
import { GameObject } from 'ssh/game/object'
import type { SaveIndexes } from 'ssh/serialization'
import { isContract } from 'ssh/types'
import { toAxialCoord } from 'ssh/utils/position'

/**
 * Reference token for a native (host-provided) function. Serialized as `{ __fnRef }`.
 * The path is a dotted traversal of the execution context (e.g. `work.harvest`), so it
 * names a *slot* in a deterministic tree — not a heap object — and can be resolved
 * against a freshly reconstituted context after reload.
 */
export interface FnRefToken {
	__fnRef: string
}

/**
 * Reference token for a game object. Serialized as `{ __gameRef }`.
 * - Tile-scoped contents are referenced by `coord` (resolved via `hex.getTile`).
 * - Indexed entities (vehicles, characters, freight lines, hive plans) are referenced
 *   by their save index, resolved via the load-side {@link SaveIndexes}.
 */
export interface GameRefToken {
	__gameRef: {
		kind: 'tile' | 'tileContent' | 'character' | 'vehicle' | 'freightLine' | 'hivePlan'
		/** Tile-scoped: axial coordinate of the tile (`tile`) or its content (`tileContent`). */
		coord?: [number, number]
		/** Indexed: serialization number in the matching {@link SaveIndexes} store. */
		index?: number
		/** Character only: the character being (de)serialized itself. */
		self?: boolean
	}
}

/**
 * Build a `function → dotted-path` index over an execution context.
 *
 * The context is a deterministic namespace tree (`find`/`inventory`/`walk`/`selfCare`/
 * `vehicle`/`work`/`plan` plus script entry points and `GlobalContext` methods), so the
 * same path always names the same function across reloads. Only *contract* functions
 * (`isContract`) are indexed — they are the only natives a script can meaningfully store.
 */
export function buildFunctionIndex(context: ExecutionContext): Map<Function, string> {
	const index = new Map<Function, string>()
	const seen = new Set<object>()

	const walk = (node: object, path: string): void => {
		if (node === null || typeof node !== 'object' || seen.has(node)) return
		seen.add(node)
		let current: object | null = node
		while (current && current !== Object.prototype) {
			for (const key of Object.getOwnPropertyNames(current)) {
				if (key === 'constructor') continue
				// Skip accessors (getters like `I`, `tile`) — reading them would trigger side
				// effects and return non-callable values anyway.
				const descriptor = Object.getOwnPropertyDescriptor(current, key)
				if (!descriptor || !('value' in descriptor)) continue
				const value = descriptor.value
				if (typeof value === 'function') {
					if (isContract(value)) index.set(value, `${path}${key}`)
				} else if (value !== null && typeof value === 'object') {
					walk(value, `${path}${key}.`)
				}
			}
			current = Object.getPrototypeOf(current)
		}
	}

	walk(context as object, '')
	return index
}

/** Resolve a dotted path to a function within a freshly reconstituted context. */
export function resolveFunctionPath(context: ExecutionContext, path: string): Function | undefined {
	let node: unknown = context
	for (const part of path.split('.')) {
		if (node === null || typeof node !== 'object') return undefined
		node = (node as Record<string, unknown>)[part]
	}
	return typeof node === 'function' ? node : undefined
}

/**
 * Serialization hook: substitute native functions and game objects with reference tokens.
 *
 * - Contract function → `{ __fnRef: path }` (via {@link buildFunctionIndex}).
 * - `TileContent` (alveoli, dwellings, …) → `{ __gameRef: { kind: 'tileContent', coord } }`.
 * - Character / vehicle / freight line / hive plan → `{ __gameRef: { kind, index } }`
 *   (a character reference to the serialized character itself is marked `self`).
 *
 * Any other function (non-contract closure) throws — it cannot be referenced by path, so
 * the caller must treat the state as non-resumable.
 */
export function makeSerializeHook(
	context: ExecutionContext,
	indexes: SaveIndexes,
	self: object
): StateValueHook {
	const fnIndex = buildFunctionIndex(context)
	const selfRaw = unwrap(self)

	return (value) => {
		if (typeof value === 'function') {
			if (isContract(value as (args: any[]) => any)) {
				const path = fnIndex.get(value)
				if (path !== undefined) return { __fnRef: path } satisfies FnRefToken
				throw new Error(`Contract function has no context path: ${(value as any).name}`)
			}
			throw new Error(`Cannot serialize non-contract function: ${(value as any).name}`)
		}
		if (value !== null && typeof value === 'object') {
			const raw = unwrap(value)

			if (raw instanceof TileContent) {
				const coord = toAxialCoord((raw as TileContent).tile.position)
				if (!coord) throw new Error('TileContent has no serializable coordinate')
				return {
					__gameRef: { kind: 'tileContent', coord: [coord.q, coord.r] },
				} satisfies GameRefToken
			}

			if (raw instanceof Tile) {
				const coord = toAxialCoord((raw as Tile).position)
				if (!coord) throw new Error('Tile has no serializable coordinate')
				return {
					__gameRef: { kind: 'tile', coord: [coord.q, coord.r] },
				} satisfies GameRefToken
			}

			const characterIndex = indexes.characters.toIndex(value as never)
			if (characterIndex !== undefined) {
				if (raw === selfRaw) {
					return { __gameRef: { kind: 'character', self: true } } satisfies GameRefToken
				}
				return {
					__gameRef: { kind: 'character', index: characterIndex },
				} satisfies GameRefToken
			}

			const vehicleIndex = indexes.vehicles.toIndex(value as never)
			if (vehicleIndex !== undefined) {
				return { __gameRef: { kind: 'vehicle', index: vehicleIndex } } satisfies GameRefToken
			}

			const freightIndex = indexes.freightLines.toIndex(value as never)
			if (freightIndex !== undefined) {
				return { __gameRef: { kind: 'freightLine', index: freightIndex } } satisfies GameRefToken
			}

			const hivePlanIndex = indexes.hivePlans.toIndex(value as never)
			if (hivePlanIndex !== undefined) {
				return { __gameRef: { kind: 'hivePlan', index: hivePlanIndex } } satisfies GameRefToken
			}

			if (raw instanceof GameObject) {
				throw new Error(`Cannot serialize game object of type ${raw.constructor?.name}`)
			}
		}
		return undefined
	}
}

/**
 * Revive hook: resolve reference tokens produced by {@link makeSerializeHook}.
 *
 * - `{ __fnRef }` → resolve the path against the freshly built `context`.
 * - `{ __gameRef }` → resolve tile-scoped refs via `game.hex.getTile`, indexed refs via
 *   `indexes`. Throws on any unresolvable token (the caller treats this as non-resumable).
 */
export function makeReviveHook(
	context: ExecutionContext,
	indexes: SaveIndexes,
	game: Game,
	self: object
): StateValueHook {
	return (value) => {
		if (value === null || typeof value !== 'object') return undefined

		const fnRef = (value as FnRefToken).__fnRef
		if (typeof fnRef === 'string') {
			const fn = resolveFunctionPath(context, fnRef)
			if (typeof fn !== 'function') {
				throw new Error(`Could not resolve native function path: ${fnRef}`)
			}
			return fn
		}

		const gameRef = (value as GameRefToken).__gameRef
		if (gameRef && typeof gameRef === 'object') {
			switch (gameRef.kind) {
				case 'tile': {
					if (!gameRef.coord) throw new Error('tile token missing coord')
					const tile = game.hex.getTile({ q: gameRef.coord[0], r: gameRef.coord[1] })
					if (!tile) throw new Error(`No tile at ${gameRef.coord}`)
					return tile
				}
				case 'tileContent': {
					if (!gameRef.coord) throw new Error('tileContent token missing coord')
					const tile = game.hex.getTile({ q: gameRef.coord[0], r: gameRef.coord[1] })
					const content = tile?.content
					if (!content) throw new Error(`No tile content at ${gameRef.coord}`)
					return content
				}
				case 'character': {
					if (gameRef.self) return self
					const character = indexes.characters.fromIndex(gameRef.index!)
					if (!character) throw new Error(`No character at index ${gameRef.index}`)
					return character
				}
				case 'vehicle': {
					const vehicle = indexes.vehicles.fromIndex(gameRef.index!)
					if (!vehicle) throw new Error(`No vehicle at index ${gameRef.index}`)
					return vehicle
				}
				case 'freightLine': {
					const line = indexes.freightLines.fromIndex(gameRef.index!)
					if (!line) throw new Error(`No freight line at index ${gameRef.index}`)
					return line
				}
				case 'hivePlan': {
					const plan = indexes.hivePlans.fromIndex(gameRef.index!)
					if (!plan) throw new Error(`No hive plan at index ${gameRef.index}`)
					return plan
				}
			}
		}

		return undefined
	}
}

export { reviveExecutionState, serializeExecutionState }
