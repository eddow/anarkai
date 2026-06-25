import { reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import type { ZoneDefinition } from 'ssh/board/zone'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'

export const freightLineOverlay = reactive({
	line: undefined as FreightLineDefinition | undefined,
	hoveredStop: undefined as FreightStop | undefined,
})

export const zoneOverlayState = reactive({
	hoveredZone: undefined as ZoneDefinition | undefined,
	hoveredHiveAnchorTile: undefined as Tile | undefined,
})

export function showFreightLineOverlay(line: FreightLineDefinition | undefined): void {
	freightLineOverlay.line = line
}

export function hoverFreightLineStop(stop: FreightStop | undefined): void {
	freightLineOverlay.hoveredStop = stop
}
