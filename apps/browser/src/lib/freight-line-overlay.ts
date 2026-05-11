import { reactive } from 'mutts'

export const freightLineOverlay = reactive({
	lineId: undefined as string | undefined,
	hoveredStopId: undefined as string | undefined,
})

export const zoneOverlayState = reactive({
	selectedZoneId: undefined as string | undefined,
	hoveredZoneId: undefined as string | undefined,
	hoveredHiveAnchorTileUid: undefined as string | undefined,
})

export function showFreightLineOverlay(lineId: string | undefined): void {
	freightLineOverlay.lineId = lineId
}

export function hoverFreightLineStop(stopId: string | undefined): void {
	freightLineOverlay.hoveredStopId = stopId
}
