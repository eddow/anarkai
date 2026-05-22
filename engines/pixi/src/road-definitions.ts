import type { RoadType } from 'ssh/board/roads'
import { tileSize } from 'ssh/utils/varied'
import { roads as roadDefinitions } from '../assets/visual-content'

function colorNumber(hexColor: string): number {
	const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor
	return Number.parseInt(hex, 16)
}

function roadTypeDefinition(type: RoadType) {
	return roadDefinitions.types[type]
}

export function roadTileTexturePixels(type: RoadType): number {
	return roadTypeDefinition(type).tileTexturePixels
}

export function roadTileWorldSize(type: RoadType): number {
	return tileSize * roadTypeDefinition(type).tileTextureWorldSizeTileSideMultiplier
}

export function roadPathWidth(type: RoadType): number {
	return tileSize * roadTypeDefinition(type).pathWidthTileSideMultiplier
}

export function roadMaterialWorldSize(type: RoadType): number {
	return roadPathWidth(type) * roadTypeDefinition(type).materialWorldSizePathWidthMultiplier
}

export function roadEdgeFade(type: RoadType): number {
	return tileSize * roadTypeDefinition(type).edgeFadeTileSideMultiplier
}

export function roadMaterialSpec(type: RoadType): string {
	return roadTypeDefinition(type).texture
}

export function roadFallbackRgb(type: RoadType): readonly [number, number, number] {
	return roadTypeDefinition(type).fallbackRgb
}

export function roadMacroStyle(type: RoadType): {
	readonly color: number
	readonly widthMultiplier: number
	readonly alpha: number
} {
	const macro = roadTypeDefinition(type).macro
	return {
		color: colorNumber(macro.color),
		widthMultiplier: macro.widthMultiplier,
		alpha: macro.alpha,
	}
}

export function roadLineStyle(type: RoadType): {
	readonly color: number
	readonly width: number
	readonly alpha: number
} {
	const line = roadTypeDefinition(type).line
	return {
		color: colorNumber(line.color),
		width: line.width,
		alpha: line.alpha,
	}
}
