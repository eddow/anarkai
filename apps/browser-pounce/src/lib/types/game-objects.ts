import { scope, type } from 'arktype'
import { TileBorder } from '$lib/game/board/border/border'
import { Alveolus } from '$lib/game/board/content/alveolus'
import { TileContent } from '$lib/game/board/content/content'
import { Tile } from '$lib/game/board/tile'
import { BuildAlveolus } from '$lib/game/hive/build'
import { EngineerAlveolus } from '$lib/game/hive/engineer'
import { GatherAlveolus } from '$lib/game/hive/gather'
import { HarvestAlveolus } from '$lib/game/hive/harvest'
import { baseGameScope } from './base'

/**
 * Game Objects Module
 *
 * Defines type validators for game object classes using type.instanceOf().
 * This module can be imported by domain scopes that need to reference game objects.
 */

export const gameObjectsModule = scope({
	...baseGameScope.export(),
	Tile: type.instanceOf(Tile),
	TileBorder: type.instanceOf(TileBorder),
	TileContent: type.instanceOf(TileContent),
	Alveolus: type.instanceOf(Alveolus),
	HarvestAlveolus: type.instanceOf(HarvestAlveolus),
	GatherAlveolus: type.instanceOf(GatherAlveolus),
	EngineerAlveolus: type.instanceOf(EngineerAlveolus),
	BuildAlveolus: type.instanceOf(BuildAlveolus),
}).export()
