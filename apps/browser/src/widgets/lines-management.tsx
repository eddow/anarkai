import { css } from '@app/lib/css'
import { selectInspectorObject } from '@app/lib/follow-selection'
import { showFreightLineOverlay } from '@app/lib/freight-line-overlay'
import { game } from '@app/lib/globals'
import { InspectorSection, Panel } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { effect, reactive } from 'mutts'
import { tablerOutlineFilter, tablerOutlineFilterCheck } from 'pure-glyf/icons'
import {
	createSyntheticFreightLineObject,
	type FreightLineDefinition,
	type FreightStop,
	freightZoneFallbackPosition,
} from 'ssh/freight/freight-line'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { AxialCoord } from 'ssh/utils'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'

css`
.lines-management {
	height: 100%;
	box-sizing: border-box;
	color: var(--ak-text);
	background: var(--app-bg);
}

.lines-management__content {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	height: 100%;
	box-sizing: border-box;
	padding: 0.75rem;
}

.lines-management__filters {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	gap: 0.5rem;
	align-items: center;
}

.lines-management__input {
	box-sizing: border-box;
	min-width: 0;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.4rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	font-size: 0.78rem;
}

.lines-management__filter-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.3rem;
	min-height: 2rem;
	padding: 0.25rem 0.55rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 20%, transparent);
	border-radius: 0.4rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.76rem;
	line-height: 1;
	white-space: nowrap;
}

.lines-management__filter-button:hover,
.lines-management__filter-button:focus-visible {
	border-color: color-mix(in srgb, var(--ak-accent, #6d8cff) 35%, transparent);
	outline: none;
}

.lines-management__filter-button[aria-checked='true'] {
	border-color: color-mix(in srgb, var(--ak-accent, #6d8cff) 42%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #6d8cff) 14%, var(--ak-surface-panel));
}

.lines-management__filter-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	inline-size: 1rem;
	block-size: 1rem;
}

.lines-management__list {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	min-height: 0;
	overflow-y: auto;
}

.lines-management__row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.55rem;
	align-items: center;
	width: 100%;
	padding: 0.45rem 0.55rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 14%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-1) 76%, transparent);
	color: inherit;
	text-align: left;
	cursor: pointer;
}

.lines-management__row:hover,
.lines-management__row:focus-visible {
	border-color: color-mix(in srgb, var(--ak-accent, #6d8cff) 38%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #6d8cff) 10%, var(--ak-surface-1));
	outline: none;
}

.lines-management__name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}

.lines-management__meta {
	display: inline-flex;
	gap: 0.35rem;
	align-items: center;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	white-space: nowrap;
}

.lines-management__badge {
	padding: 0.12rem 0.35rem;
	border-radius: 0.3rem;
	background: color-mix(in srgb, var(--ak-text-muted) 12%, transparent);
}

.lines-management__empty {
	padding: 0.5rem;
	color: var(--ak-text-muted);
	font-size: 0.82rem;
}

@media (max-width: 520px) {
	.lines-management__filters {
		grid-template-columns: minmax(0, 1fr);
	}
}
`

function lineHasBay(line: FreightLineDefinition): boolean {
	return line.stops.some((stop) => 'anchor' in stop)
}

function stopCoord(stop: FreightStop): AxialCoord | undefined {
	if ('anchor' in stop) return { q: stop.anchor.coord[0], r: stop.anchor.coord[1] }
	if ('trade' in stop) {
		const position = game.getSettlementTradeProfile(stop.trade.settlementId)?.cityHall.position
		if (!position) return undefined
		try {
			return toAxialCoord(position)
		} catch {
			return undefined
		}
	}
	if (stop.zone.kind === 'radius') return { q: stop.zone.center[0], r: stop.zone.center[1] }
	const fallback = freightZoneFallbackPosition(game, stop.zone)
	if (!fallback) return undefined
	try {
		return toAxialCoord(fallback)
	} catch {
		return undefined
	}
}

function screenPointForCoord(coord: AxialCoord): { x: number; y: number } | undefined {
	const renderer = game.renderer as
		| {
				app?: { screen?: { width: number; height: number } }
				world?: { position?: { x: number; y: number }; scale?: { x?: number; y?: number } }
		  }
		| undefined
	let worldCoord: { x: number; y: number }
	try {
		worldCoord = toWorldCoord(coord)
	} catch {
		return undefined
	}
	const screen = renderer?.app?.screen
	const world = renderer?.world
	if (!worldCoord || !screen || !world) return undefined
	const scaleX = world.scale?.x ?? 1
	const scaleY = world.scale?.y ?? scaleX
	return {
		x: worldCoord.x * scaleX + (world.position?.x ?? 0),
		y: worldCoord.y * scaleY + (world.position?.y ?? 0),
	}
}

function coordInViewport(coord: AxialCoord | undefined): boolean {
	if (!coord) return false
	const renderer = game.renderer as
		| { app?: { screen?: { width: number; height: number } } }
		| undefined
	const screen = renderer?.app?.screen
	const point = screenPointForCoord(coord)
	if (!screen || !point) return false
	return point.x >= 0 && point.x <= screen.width && point.y >= 0 && point.y <= screen.height
}

function vehicleCoord(vehicle: unknown): AxialCoord | undefined {
	const candidate = vehicle as { effectivePosition?: unknown; position?: unknown }
	const position = candidate.effectivePosition ?? candidate.position
	if (
		position &&
		typeof position === 'object' &&
		'q' in position &&
		'r' in position &&
		typeof position.q === 'number' &&
		typeof position.r === 'number'
	) {
		return { q: position.q, r: position.r }
	}
	return undefined
}

function lineHasVisibleStop(line: FreightLineDefinition): boolean {
	return line.stops.some((stop) => coordInViewport(stopCoord(stop)))
}

function lineHasVisibleServingVehicle(line: FreightLineDefinition): boolean {
	const vehicles = game.vehicles ? [...game.vehicles] : []
	return vehicles.some((vehicle) => {
		const service = vehicle.service
		return (
			isVehicleLineService(service) &&
			service.line.id === line.id &&
			coordInViewport(vehicleCoord(vehicle))
		)
	})
}

function lineIsVisible(line: FreightLineDefinition): boolean {
	return lineHasVisibleStop(line) || lineHasVisibleServingVehicle(line)
}

const LinesManagementWidget = (
	props: DockviewWidgetProps<Record<string, never>>,
	scope: DockviewWidgetScope
) => {
	props.title = 'Lines'
	const state = reactive({
		text: '',
		visibleOnly: false,
		noBayOnly: false,
		viewportTick: 0,
		hoveredLineId: undefined as string | undefined,
	})
	const filteredLines = () => {
		void state.viewportTick
		const needle = state.text.trim().toLowerCase()
		return (game.freightLines ?? []).filter((line) => {
			if (needle && !line.name.toLowerCase().includes(needle)) return false
			if (state.noBayOnly && lineHasBay(line)) return false
			if (state.visibleOnly && !lineIsVisible(line)) return false
			return true
		})
	}
	const openLine = (line: FreightLineDefinition) => {
		selectInspectorObject(createSyntheticFreightLineObject(game, line), scope.dockviewApi)
	}
	const showLine = (lineId: string | undefined) => {
		state.hoveredLineId = lineId
		showFreightLineOverlay(lineId)
	}

	effect`lines-management:viewport-refresh`(() => {
		if (typeof window === 'undefined') return
		const id = window.setInterval(() => {
			if (state.visibleOnly) state.viewportTick++
		}, 250)
		return () => window.clearInterval(id)
	})

	effect`lines-management:overlay-cleanup`(() => {
		return () => showFreightLineOverlay(undefined)
	})
	effect`lines-management:clear-filtered-hover`(() => {
		const hoveredLineId = state.hoveredLineId
		if (!hoveredLineId) return
		if (filteredLines().some((line) => line.id === hoveredLineId)) return
		showLine(undefined)
	})

	return (
		<Panel class="lines-management">
			<InspectorSection class="lines-management__content" title="Lines">
				<div class="lines-management__filters">
					<input
						class="lines-management__input"
						type="search"
						placeholder="Filter by name..."
						aria-label="Filter lines by name"
						value={state.text}
						onInput={(event) => {
							state.text = (event.currentTarget as HTMLInputElement).value
						}}
					/>
					<button
						type="button"
						class="lines-management__filter-button"
						role="checkbox"
						aria-checked={state.visibleOnly ? 'true' : 'false'}
						aria-label="Filter lines by visibility"
						title="Show only lines with a visible stop or active vehicle"
						onClick={() => {
							state.visibleOnly = !state.visibleOnly
						}}
					>
						<span class="lines-management__filter-icon">
							{renderAnarkaiIcon(
								state.visibleOnly ? tablerOutlineFilterCheck : tablerOutlineFilter,
								{
									size: 14,
								}
							)}
						</span>
						<span>Visible</span>
					</button>
					<button
						type="button"
						class="lines-management__filter-button"
						role="checkbox"
						aria-checked={state.noBayOnly ? 'true' : 'false'}
						aria-label="Filter lines by bay"
						title="Show only lines without a bay stop"
						onClick={() => {
							state.noBayOnly = !state.noBayOnly
						}}
					>
						<span class="lines-management__filter-icon">
							{renderAnarkaiIcon(state.noBayOnly ? tablerOutlineFilterCheck : tablerOutlineFilter, {
								size: 14,
							})}
						</span>
						<span>No bay</span>
					</button>
				</div>
				<div class="lines-management__list">
					<for each={filteredLines()}>
						{(line) => (
							<button
								type="button"
								class="lines-management__row"
								data-testid="line-management-row"
								data-line-id={line.id}
								title={line.name}
								onMouseenter={() => showLine(line.id)}
								onMouseleave={() => showLine(undefined)}
								onFocus={() => showLine(line.id)}
								onBlur={() => showLine(undefined)}
								onClick={() => openLine(line)}
							>
								<span class="lines-management__name">{line.name}</span>
								<span class="lines-management__meta">
									<span class="lines-management__badge">{line.stops.length} stops</span>
									<span if={lineHasBay(line)} class="lines-management__badge">
										bay
									</span>
								</span>
							</button>
						)}
					</for>
					<div if={filteredLines().length === 0} class="lines-management__empty">
						No lines match these filters.
					</div>
				</div>
			</InspectorSection>
		</Panel>
	)
}

export default LinesManagementWidget
