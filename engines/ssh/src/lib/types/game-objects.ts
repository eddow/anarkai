import { scope, type } from 'arktype'
import { TileBorder } from 'ssh/src/lib/board/border/border'
import { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import { TileContent } from 'ssh/src/lib/board/content/content'
import { Tile } from 'ssh/src/lib/board/tile'
import { HarvestAlveolus } from 'ssh/src/lib/hive/harvest'
import { baseGameScope } from './base'



/**
 * Game Objects Module
 *
 * Defines type validators for game object classes using type.instanceOf().
 * This module can be imported by domain scopes that need to reference game objects.
 */

// Helper for robust instance checking (handles dual-package hazards in dev)
// For base classes, we use strict instanceof checks.
const instance = <T extends abstract new (...args: any[]) => any>(
	clsFn: T | (() => T),
	className: string,
) =>
	(
		type('object').narrow((data): data is InstanceType<T> => {
			const cls =
				typeof clsFn === 'function' && !('prototype' in clsFn) ? (clsFn as () => T)() : (clsFn as T)
			return data instanceof cls
		}) as any
	).describe(className)

// Base Alveolus validator - robustly checks for Alveolus instance
const AlveolusDef = instance(() => Alveolus, 'Alveolus')

export const gameObjectsModule = scope({
	...baseGameScope.export(),
	Tile: instance(() => Tile, 'Tile'),
	TileBorder: instance(() => TileBorder, 'TileBorder'),
	TileContent: instance(() => TileContent, 'TileContent'),
	Alveolus: AlveolusDef,

	// Specific Alveoli are refined from the base Alveolus by checking their action type
	HarvestAlveolus: AlveolusDef.and({ action: { type: "'harvest'" } }).describe('HarvestAlveolus'),
	GatherAlveolus: AlveolusDef.and({ action: { type: "'gather'" } }).describe('GatherAlveolus'),
	EngineerAlveolus: AlveolusDef.and({ action: { type: "'engineer'" } }).describe(
		'EngineerAlveolus',
	),
	BuildAlveolus: AlveolusDef.and({ target: 'string' }).describe('BuildAlveolus'), // BuildAlveolus has a 'target' property
}).export()
