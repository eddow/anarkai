import { effect } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import {
	type ConstructionSiteState,
	normalizeConstructionSiteState,
	setConstructionDeliveredGoods,
} from 'ssh/construction-state'
import type { Storage } from 'ssh/storage/storage'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'

/**
 * Shared construction-shell helpers for in-progress sites (`BuildAlveolus`, `BuildDwelling`).
 * Keeps material math and phase sync identical across hive and residential shells (roadmap:
 * one workflow, multiple consumers).
 */

export interface ConstructionMaterialShell {
	readonly constructionSite: ConstructionSiteState
	readonly storage: Storage
	readonly destroyed: boolean
	readonly uid?: string
}

/**
 * Shared structural contract for any in-progress construction shell on a tile.
 *
 * Runtime classes differ by target, but construction-facing semantics should stay identical.
 */
export interface ConstructionSiteShell extends ConstructionMaterialShell {
	readonly tile: Tile
	readonly working: boolean
	constructionWorkSecondsApplied: number
	canTake(goodType: GoodType, priority: ExchangePriority): boolean
	canGive(goodType: GoodType, priority: ExchangePriority): boolean
	readonly requiredGoods: Record<GoodType, number>
	readonly remainingNeeds: Record<string, number>
	readonly advertisedNeeds: Record<string, number>
	readonly isReady: boolean
	readonly workingGoodsRelations: GoodsRelations
}

/** Compatibility alias while callers migrate to `ConstructionSiteShell`. */
export type BuildSite = ConstructionSiteShell

export function isConstructionSiteShell(value: unknown): value is ConstructionSiteShell {
	return (
		typeof value === 'object' &&
		value !== null &&
		'tile' in value &&
		'constructionSite' in value &&
		'storage' in value &&
		'constructionWorkSecondsApplied' in value
	)
}

/** Compatibility alias while callers migrate to `isConstructionSiteShell`. */
export const isBuildSite = isConstructionSiteShell

/** Standalone construction shells (`BuildAlveolus`, `BuildDwelling`, ...). */
export function isStandaloneConstructionSiteShell(
	content: unknown
): content is ConstructionSiteShell {
	return isConstructionSiteShell(content)
}

/** Compatibility alias while callers migrate to `isStandaloneConstructionSiteShell`. */
export const isStandaloneBuildSiteShell = isStandaloneConstructionSiteShell

export function materialRemainingNeeds(
	requiredGoods: Partial<Record<GoodType, number>>,
	storage?: Storage
): Record<string, number> {
	const needs: Record<string, number> = {}
	if (!storage?.stock) {
		for (const [good, qty] of Object.entries(requiredGoods)) {
			const n = qty ?? 0
			if (n > 0) needs[good] = n
		}
		return needs
	}
	for (const [good, qty] of Object.entries(requiredGoods)) {
		const goodType = good as GoodType
		const target = qty ?? 0
		const have = storage.available(goodType) || 0
		if (have < target) needs[good] = target - have
	}
	return needs
}

export function materialAdvertisedNeeds(
	requiredGoods: Partial<Record<GoodType, number>>,
	storage: Storage
): Record<string, number> {
	const needs: Record<string, number> = {}
	for (const [good, qty] of Object.entries(requiredGoods)) {
		const goodType = good as GoodType
		const room = Math.max(0, storage.hasRoom(goodType))
		if (room > 0) needs[good] = Math.min(qty ?? 0, room)
	}
	return needs
}

export function materialDemandRelations(
	requiredGoods: Partial<Record<GoodType, number>>,
	advertisedNeeds: Record<string, number>,
	destroyed: boolean
): GoodsRelations {
	if (destroyed) return {}
	return Object.fromEntries(
		Object.entries(requiredGoods)
			.filter(([goodType]) => (advertisedNeeds[goodType] ?? 0) > 0)
			.map(([goodType]) => [
				goodType as GoodType,
				{ advertisement: 'demand', priority: '2-use' as const },
			])
	)
}

export function materialsComplete(shell: ConstructionMaterialShell): boolean {
	return (
		Object.keys(
			materialRemainingNeeds(
				normalizeConstructionSiteState(shell.constructionSite).requiredGoods,
				shell.storage
			)
		).length === 0 && !shell.destroyed
	)
}

export function buildSiteCanTake(
	this: ConstructionSiteShell,
	goodType: GoodType,
	_priority: ExchangePriority
): boolean {
	if (!this.working) return false
	return (this.advertisedNeeds[goodType] ?? 0) > 0 && !this.destroyed
}

export function buildSiteCanGive(
	this: ConstructionSiteShell,
	_goodType: GoodType,
	_priority: ExchangePriority
): boolean {
	return false
}

interface InstallBuildSitePrototypeOptions {
	readonly aliasGoodsRelations?: boolean
}

/**
 * Installs the shared `ConstructionSiteShell` accessors on classes whose inheritance trees differ
 * but whose construction semantics are the same.
 */
export function installBuildSitePrototype(
	prototype: object,
	options: InstallBuildSitePrototypeOptions = {}
): void {
	Object.defineProperties(prototype, {
		canTake: {
			value: buildSiteCanTake,
			writable: true,
			configurable: true,
		},
		canGive: {
			value: buildSiteCanGive,
			writable: true,
			configurable: true,
		},
		requiredGoods: {
			get(this: ConstructionSiteShell) {
				return normalizeConstructionSiteState(this.constructionSite).requiredGoods as Record<
					GoodType,
					number
				>
			},
			configurable: true,
		},
		remainingNeeds: {
			get(this: ConstructionSiteShell) {
				return materialRemainingNeeds(
					normalizeConstructionSiteState(this.constructionSite).requiredGoods,
					this.storage
				)
			},
			configurable: true,
		},
		advertisedNeeds: {
			get(this: ConstructionSiteShell) {
				return materialAdvertisedNeeds(
					normalizeConstructionSiteState(this.constructionSite).requiredGoods,
					this.storage
				)
			},
			configurable: true,
		},
		isReady: {
			get(this: ConstructionSiteShell) {
				return materialsComplete(this)
			},
			configurable: true,
		},
		workingGoodsRelations: {
			get(this: ConstructionSiteShell) {
				return materialDemandRelations(
					normalizeConstructionSiteState(this.constructionSite).requiredGoods,
					this.advertisedNeeds,
					this.destroyed
				)
			},
			configurable: true,
		},
		...(options.aliasGoodsRelations
			? {
					goodsRelations: {
						get(this: ConstructionSiteShell) {
							return this.workingGoodsRelations
						},
						configurable: true,
					},
				}
			: {}),
	})
}

/**
 * Syncs `constructionSite` phase and delivered-goods snapshot from shell storage (shared by
 * `BuildAlveolus` and `BuildDwelling`).
 */
export function registerConstructionMaterialPhaseEffect(
	debugLabel: string,
	shell: ConstructionMaterialShell
): void {
	effect`build-site:${debugLabel}`(() => {
		const constructionSite = normalizeConstructionSiteState(shell.constructionSite)
		const deliveredGoods = (shell.storage?.stock ?? {}) as Partial<Record<GoodType, number>>
		setConstructionDeliveredGoods(constructionSite, deliveredGoods)
		if (shell.destroyed) {
			if (constructionSite.workSecondsApplied < constructionSite.recipe.workSeconds) {
				constructionSite.phase = 'failed'
			}
			return
		}
		if (!materialsComplete(shell)) {
			if (constructionSite.phase !== 'building') {
				constructionSite.phase = 'waiting_materials'
			}
			return
		}
		if (constructionSite.phase !== 'building') {
			constructionSite.phase = 'waiting_construction'
		}
	})
}
