import { css } from '@app/lib/css'
import { type FreightDraftIssueCode, freightDraftIssueCodes } from '@app/lib/freight-line-draft'
import { showFreightLineOverlay } from '@app/lib/freight-line-overlay'
import { clearFreightMapPickForLine } from '@app/lib/freight-map-pick'
import { bumpSelectionTitleVersion, selectionState } from '@app/lib/globals'
import { T } from '@app/lib/i18n'
import { InspectorSection } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { effect, reactive } from 'mutts'
import { tablerOutlineRepeat, tablerOutlineTrash } from 'pure-glyf/icons'
import type { FreightLineDefinition, SyntheticFreightLineObject } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import {
	type FreightLineRouteStatus,
	type FreightLineVehicleStatus,
	summarizeFreightLineRoute,
} from 'ssh/freight/freight-stop-utility'
import { isLineFreightVehicleType } from 'ssh/freight/line-freight-vehicles'
import type { Game, TradeTransferLogEntry } from 'ssh/game'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { type AxialCoord, toAxialCoord } from 'ssh/utils'
import FreightStopList from '../FreightStopList'
import HardListSearchPicker, { type HardListSearchPickerItem } from '../HardListSearchPicker'
import InspectorObjectLink from '../InspectorObjectLink'
import LinkedEntityControl from '../LinkedEntityControl'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'

css`
.freight-line-properties__name {
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
}

.freight-line-properties__uid {
	font-family: ui-monospace, monospace;
	font-size: 0.75rem;
	color: var(--ak-text-muted);
	word-break: break-word;
}

.freight-line-properties__actions {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.45rem;
	width: 100%;
}

.freight-line-properties__header {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	margin-bottom: 0.5rem;
}

.freight-line-properties__header .freight-line-properties__name {
	flex: 1;
}

.freight-line-properties__icon-btn {
	display: inline-grid;
	place-items: center;
	inline-size: 2rem;
	block-size: 2rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
}

.freight-line-properties__icon-btn[aria-pressed="true"] {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 42%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 14%, var(--ak-surface-panel));
}

.freight-line-properties__icon-btn.danger {
	border-color: color-mix(in srgb, var(--ak-danger, #c44) 35%, transparent);
	color: var(--ak-danger, #c44);
}

.freight-line-properties__issues {
	margin: 0;
	padding-inline-start: 1.1rem;
	font-size: 0.78rem;
	color: var(--ak-danger, #c44);
}

.freight-line-properties__assignment-list {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.freight-line-properties__assignment-row {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	flex-wrap: wrap;
	padding: 0.35rem 0.45rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.4rem;
	background: color-mix(in srgb, var(--ak-surface-1) 78%, transparent);
}

.freight-line-properties__assignment-remove {
	margin-inline-start: auto;
	border: 0;
	background: transparent;
	color: var(--ak-danger, #c44);
	cursor: pointer;
	font-size: 1rem;
	line-height: 1;
}

.freight-line-properties__assignment-empty {
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}

.freight-line-properties__route-summary {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	font-size: 0.78rem;
}

.freight-line-properties__route-status {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.15rem 0.5rem;
	border-radius: 0.35rem;
	font-weight: 600;
	font-size: 0.72rem;
	text-transform: uppercase;
}

.freight-line-properties__route-status--active {
	background: color-mix(in srgb, #22c55e 18%, transparent);
	color: #22c55e;
}

.freight-line-properties__route-status--idle {
	background: color-mix(in srgb, var(--ak-warning, #d8a33f) 18%, transparent);
	color: var(--ak-warning, #d8a33f);
}

.freight-line-properties__route-status--complete {
	background: color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	color: var(--ak-text-muted);
}

.freight-line-properties__vehicle-status {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.freight-line-properties__vehicle-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	flex-wrap: wrap;
	padding: 0.25rem 0;
	border-bottom: 1px solid color-mix(in srgb, var(--ak-text-muted) 8%, transparent);
}

.freight-line-properties__vehicle-row:last-child {
	border-bottom: none;
}

.freight-line-properties__vehicle-cargo {
	color: var(--ak-text-muted);
	font-size: 0.72rem;
}

.freight-line-properties__route-demand {
	color: var(--ak-text-muted);
	font-size: 0.72rem;
}

.freight-line-properties__trade-history {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	font-size: 0.72rem;
}

.freight-line-properties__trade-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	flex-wrap: wrap;
	padding: 0.2rem 0;
	border-bottom: 1px solid color-mix(in srgb, var(--ak-text-muted) 8%, transparent);
}

.freight-line-properties__trade-row:last-child {
	border-bottom: none;
}

.freight-line-properties__trade-stop {
	color: var(--ak-text);
	font-weight: 600;
}

.freight-line-properties__trade-export {
	color: #22c55e;
}

.freight-line-properties__trade-import {
	color: #f59e0b;
}

.freight-line-properties__trade-empty {
	color: var(--ak-text-muted);
}

.freight-line-properties__explanation {
	color: var(--ak-text-muted);
	font-size: 0.74rem;
	line-height: 1.45;
}

.freight-line-properties__retained {
	color: #22c55e;
	font-size: 0.72rem;
}

.freight-line-properties__surplus {
	color: #f59e0b;
	font-size: 0.72rem;
}

`

interface FreightLinePropertiesProps {
	lineObject: SyntheticFreightLineObject
	onClose?: () => void
}

const issueMessage = (code: FreightDraftIssueCode): string => {
	const t = T.line.stopsEditor.issues
	switch (code) {
		case 'no_stops':
			return t.noStops
		case 'no_freight_bay_anchor':
			return t.noBay
		case 'invalid_zone_radius':
			return t.badRadius
		default:
			return code
	}
}

const icon = (source: string) => renderAnarkaiIcon(source, { size: 16 })

const lineAssignmentText = () => {
	const line = T.line as typeof T.line & {
		vehicleAssignment?: {
			section?: string
			assigned?: string
			add?: string
			filter?: string
			emptyAssigned?: string
			emptyAvailable?: string
			remove?: string
		}
	}
	return {
		section: line.vehicleAssignment?.section ?? 'Assigned vehicles',
		assigned: line.vehicleAssignment?.assigned ?? 'Vehicles',
		add: line.vehicleAssignment?.add ?? 'Add vehicle',
		filter: line.vehicleAssignment?.filter ?? 'Filter vehicles...',
		emptyAssigned: line.vehicleAssignment?.emptyAssigned ?? 'No vehicles assigned',
		emptyAvailable: line.vehicleAssignment?.emptyAvailable ?? 'No compatible vehicles available',
		remove: line.vehicleAssignment?.remove ?? 'Remove vehicle',
	}
}

function vehicleCoord(vehicle: Vehicle): AxialCoord | undefined {
	const position =
		(vehicle as Vehicle & { effectivePosition?: unknown; position?: unknown })
			.effectivePosition ?? (vehicle as Vehicle & { position?: unknown }).position
	return position ? toAxialCoord(position) : undefined
}

function vehicleStockSummary(vehicle: Vehicle): string {
	const stock = vehicle.storage?.stock ?? {}
	const entries = Object.entries(stock)
		.filter(([, qty]) => (qty ?? 0) > 0)
		.map(([good, qty]) => `${good}:${qty}`)
	return entries.length > 0 ? entries.join(', ') : 'empty'
}

function assignedVehiclesForLine(game: Game | undefined, line: FreightLineDefinition | undefined): Vehicle[] {
	if (!game?.vehicles || !line) return []
	return [...game.vehicles].filter((vehicle) =>
		vehicle.servedLines?.includes(line)
	)
}

function assignableVehicleItems(
	game: Game | undefined,
	line: FreightLineDefinition | undefined
): HardListSearchPickerItem[] {
	if (!game?.vehicles || !line) return []
	return [...game.vehicles]
		.filter((vehicle) => isLineFreightVehicleType(vehicle.vehicleType))
		.filter((vehicle) => !vehicle.servedLines?.includes(line))
		.map((vehicle) => ({
			id: vehicle.uid,
			label: vehicle.title,
			hint: `${vehicle.vehicleType} · ${vehicleStockSummary(vehicle)}`,
			coord: vehicleCoord(vehicle),
		}))
}

const FreightLineProperties = (props: FreightLinePropertiesProps) => {
	const local = reactive({ revision: 0 })
	const currentGame = () => props.lineObject?.game
	const currentLine = () => {
		void local.revision
		const fallback = props.lineObject?.line
		const lineId = props.lineObject?.lineId
		const g = currentGame()
		if (!fallback || !g || !lineId) return fallback
		return g.freightLines.find((line) => line.id === lineId) ?? fallback
	}
	const isAvailable = () => !!props.lineObject && !!currentLine()
	const readOnly = () => !isAvailable()

	effect`freight-line-properties:pick-cleanup`(() => {
		const lineId = props.lineObject?.lineId
		return () => {
			if (lineId) clearFreightMapPickForLine(lineId)
		}
	})

	const handleMouseEnter = () => {
		const lineId = props.lineObject?.lineId
		showFreightLineOverlay(lineId)
	}

	const handleMouseLeave = () => {
		showFreightLineOverlay(undefined)
	}

	const issues = () => {
		const line = currentLine()
		return line ? freightDraftIssueCodes(line) : []
	}

	const replaceLine = (next: FreightLineDefinition) => {
		const g = currentGame()
		if (!g) return
		g.replaceFreightLine(normalizeFreightLineDefinition(next))
		local.revision++
		bumpSelectionTitleVersion()
	}

	const onLineChange = (next: FreightLineDefinition) => {
		if (readOnly()) return
		replaceLine(next)
	}

	const handleNameInput = (value: string) => {
		const line = currentLine()
		if (readOnly() || !line) return
		replaceLine({ ...line, name: value })
	}

	const handleCyclicInput = (checked: boolean) => {
		const line = currentLine()
		if (readOnly() || !line) return
		replaceLine({ ...line, cyclic: checked ? true : undefined })
	}

	const handleDeleteLine = () => {
		const lineId = props.lineObject?.lineId
		const g = currentGame()
		if (!lineId || !g) return
		g.removeFreightLineById(lineId)
		if (selectionState.selectedUid === props.lineObject.uid) selectionState.selectedUid = undefined
		props.onClose?.()
		local.revision++
		bumpSelectionTitleVersion()
	}

	const handleAssignVehicle = (vehicleUid: string) => {
		const line = currentLine()
		const g = currentGame()
		if (!line || !g) return
		if ('assignVehicleToFreightLine' in g && typeof g.assignVehicleToFreightLine === 'function') {
			g.assignVehicleToFreightLine(vehicleUid, line.id)
		} else {
			const vehicle = g.vehicles?.vehicle?.(vehicleUid)
			vehicle?.assignFreightLine?.(line)
		}
		local.revision++
		bumpSelectionTitleVersion()
	}

	const handleUnassignVehicle = (vehicleUid: string) => {
		const line = currentLine()
		const g = currentGame()
		if (!line || !g) return
		if (
			'unassignVehicleFromFreightLine' in g &&
			typeof g.unassignVehicleFromFreightLine === 'function'
		) {
			g.unassignVehicleFromFreightLine(vehicleUid, line.id)
		} else {
			g.vehicles?.vehicle?.(vehicleUid)?.unassignFreightLine?.(line.id)
		}
		local.revision++
		bumpSelectionTitleVersion()
	}

	const lineName = () => currentLine()?.name ?? ''
	const assignmentText = () => lineAssignmentText()
	const assignedVehicles = () => {
		void local.revision
		return assignedVehiclesForLine(currentGame(), currentLine())
	}
	const availableVehicleItems = () => {
		void local.revision
		return assignableVehicleItems(currentGame(), currentLine())
	}

	const statusLabel = (status: FreightLineRouteStatus): string => {
		if (status === 'active') return 'Active'
		if (status === 'complete') return 'Complete'
		return 'Idle'
	}

	const routeSummary = () => {
		const g = currentGame()
		const line = currentLine()
		const vehicles = assignedVehicles()
		if (!g || !line || vehicles.length === 0) return undefined
		try {
			return summarizeFreightLineRoute({ game: g, line, vehicles })
		} catch {
			return undefined
		}
	}

	const formatCargoShort = (cargoSummary: string): string => {
		if (cargoSummary === 'empty') return cargoSummary
		const parts = cargoSummary.split(', ')
		if (parts.length <= 2) return cargoSummary
		return `${parts.slice(0, 2).join(', ')} +${parts.length - 2}`
	}

	const formatTradeGoods = (goods: Partial<Record<string, number>>): string => {
		const entries = Object.entries(goods)
			.filter(([, qty]) => (qty ?? 0) > 0)
			.map(([good, qty]) => `${good} ×${qty}`)
		return entries.length > 0 ? entries.join(', ') : 'none'
	}

	const tradeHistory = () => {
		const g = currentGame()
		const line = currentLine()
		if (!g || !line) return []
		return g.getFreightLineTradeHistory(line.id)
	}

	return (
		<InspectorSection
			title={T.line.section}
			el={{ onMouseenter: handleMouseEnter, onMouseleave: handleMouseLeave }}
		>
			{/* Header one-liner: name + cyclic + delete */}
			<div class="freight-line-properties__header">
				<input
					class="freight-line-properties__name"
					type="text"
					disabled={!isAvailable()}
					value={lineName()}
					update:value={handleNameInput}
					data-testid="freight-line-name"
				/>
				<button
					type="button"
					class="freight-line-properties__icon-btn"
					title={T.line.cyclic.hint}
					aria-label={T.line.cyclic.label}
					aria-pressed={currentLine()?.cyclic === true ? 'true' : 'false'}
					disabled={!isAvailable()}
					onClick={() => handleCyclicInput(currentLine()?.cyclic !== true)}
					data-testid="freight-line-cyclic"
				>
					{icon(tablerOutlineRepeat)}
				</button>
				<button
					type="button"
					class="freight-line-properties__icon-btn danger"
					title={T.line.deleteLine.action}
					aria-label={T.line.deleteLine.action}
					data-testid="freight-line-delete"
					onClick={handleDeleteLine}
				>
					{icon(tablerOutlineTrash)}
				</button>
			</div>
			{/* Issues — always visible, not collapsible */}
			<ul if={isAvailable() && issues().length > 0} class="freight-line-properties__issues">
				<for each={issues()}>{(code: FreightDraftIssueCode) => <li>{issueMessage(code)}</li>}</for>
			</ul>
			{/* "Unavailable" fallback */}
			<span if={!isAvailable()} class="freight-line-properties__uid">
				{T.line.unavailable}
			</span>
			{/* Assigned vehicles */}
			<InspectorSection if={isAvailable()} title={assignmentText().section} collapsible>
				<PropertyGrid>
					<PropertyGridRow label={assignmentText().assigned}>
						<div class="freight-line-properties__assignment-list">
							<for each={assignedVehicles()}>
								{(vehicle) => (
									<div
										class="freight-line-properties__assignment-row"
										data-testid="line-assigned-vehicle"
									>
										<LinkedEntityControl object={vehicle} />
										<InspectorObjectLink object={vehicle} />
										<button
											type="button"
											class="freight-line-properties__assignment-remove"
											title={assignmentText().remove}
											aria-label={assignmentText().remove}
											onClick={() => handleUnassignVehicle(vehicle.uid)}
											data-testid="line-unassign-vehicle"
										>
											×
										</button>
									</div>
								)}
							</for>
							<div
								if={assignedVehicles().length === 0}
								class="freight-line-properties__assignment-empty"
							>
								{assignmentText().emptyAssigned}
							</div>
						</div>
					</PropertyGridRow>
					<PropertyGridRow label={assignmentText().add}>
						<HardListSearchPicker
							items={availableVehicleItems()}
							onSelect={handleAssignVehicle}
							placeholder={assignmentText().filter}
							emptyMessage={assignmentText().emptyAvailable}
							testId="line-vehicle-picker"
						/>
					</PropertyGridRow>
				</PropertyGrid>
			</InspectorSection>
			{/* Stops — collapsible */}
			<InspectorSection
				if={isAvailable() && currentLine() && currentGame()}
				title={T.line.stopsEditor.section}
				collapsible
			>
				<FreightStopList
					draft={currentLine()!}
					game={currentGame()!}
					readOnly={readOnly()}
					onChange={onLineChange}
				/>
			</InspectorSection>
			{/* Route status */}
			<InspectorSection
				if={isAvailable() && routeSummary() !== undefined}
				title={T.line.routeSummary.section}
				data-testid="freight-line-route-summary"
				collapsible
			>
				<div class="freight-line-properties__route-summary">
					<PropertyGrid>
						<PropertyGridRow label="Status">
							<span
								class={`freight-line-properties__route-status freight-line-properties__route-status--${routeSummary()!.status}`}
								data-testid="freight-line-route-status"
							>
								{statusLabel(routeSummary()!.status)}
							</span>
						</PropertyGridRow>
						<PropertyGridRow>
							<span
								class="freight-line-properties__explanation"
								data-testid="freight-line-route-explanation"
							>
								{routeSummary()!.statusExplanation}
							</span>
						</PropertyGridRow>
						<PropertyGridRow if={routeSummary()!.vehicles.length > 0} label="Vehicles">
							<div class="freight-line-properties__vehicle-status">
								<for each={routeSummary()!.vehicles}>
									{(vehicle: FreightLineVehicleStatus) => (
										<div
											class="freight-line-properties__vehicle-row"
											data-testid="freight-line-vehicle-status"
										>
											<span>{vehicle.vehicleTitle}</span>
											<span class="freight-line-properties__vehicle-cargo">
												{vehicle.currentStopIndex !== undefined
													? `at stop ${vehicle.currentStopIndex + 1}`
													: 'not on route'}
												{vehicle.isDocked ? ' · docked' : ''}
												{vehicle.cargoSummary !== 'empty'
													? ` · ${formatCargoShort(vehicle.cargoSummary)}`
													: ''}
												{vehicle.actionable ? ' · ready' : ''}
											</span>
										</div>
									)}
								</for>
							</div>
						</PropertyGridRow>
						<PropertyGridRow
							if={routeSummary()!.aggregateDownstreamDemand.total > 0}
							label="Downstream demand"
						>
							<span class="freight-line-properties__route-demand">
								{formatCargoShort(
									Object.entries(routeSummary()!.aggregateDownstreamDemand.perGood)
										.filter(([, qty]) => (qty ?? 0) > 0)
										.map(([good, qty]) => `${good}:${qty}`)
										.join(', ') || 'none'
								)}
							</span>
						</PropertyGridRow>
						<PropertyGridRow
							if={routeSummary()!.aggregateRetainedCargo.total > 0}
							label="Retained cargo"
						>
							<span class="freight-line-properties__retained">
								{formatCargoShort(
									Object.entries(routeSummary()!.aggregateRetainedCargo.perGood)
										.filter(([, qty]) => (qty ?? 0) > 0)
										.map(([good, qty]) => `${good}:${qty}`)
										.join(', ') || 'none'
								)}
							</span>
						</PropertyGridRow>
						<PropertyGridRow
							if={routeSummary()!.aggregateSurplusCargo.total > 0}
							label="Surplus cargo"
						>
							<span class="freight-line-properties__surplus">
								{formatCargoShort(
									Object.entries(routeSummary()!.aggregateSurplusCargo.perGood)
										.filter(([, qty]) => (qty ?? 0) > 0)
										.map(([good, qty]) => `${good}:${qty}`)
										.join(', ') || 'none'
								)}
							</span>
						</PropertyGridRow>
						<PropertyGridRow label="Actionable stops">
							<span>
								{routeSummary()!.totalActionableStops} / {routeSummary()!.stops.length}
							</span>
						</PropertyGridRow>
					</PropertyGrid>
				</div>
			</InspectorSection>
			{/* Recent transfers */}
			<InspectorSection
				if={isAvailable() && tradeHistory().length > 0}
				title={T.line.tradeHistory.section}
				data-testid="freight-line-trade-history"
				collapsible
			>
				<div class="freight-line-properties__trade-history">
					<for each={tradeHistory().slice(0, 5)}>
						{(entry: TradeTransferLogEntry) => {
							const stop = currentLine()?.stops.find((s) => s.id === entry.stopId)
							const stopLabel = stop
								? `Stop ${currentLine()!.stops.indexOf(stop) + 1}`
								: entry.stopId
							const hasExports = Object.values(entry.exported).some((q) => (q ?? 0) > 0)
							const hasImports = Object.values(entry.imported).some((q) => (q ?? 0) > 0)
							return (
								<div class="freight-line-properties__trade-row">
									<span class="freight-line-properties__trade-stop">{stopLabel}</span>
									<span if={hasExports} class="freight-line-properties__trade-export">
										export {formatTradeGoods(entry.exported as Partial<Record<string, number>>)}+
										{entry.creditedVp} vp
									</span>
									<span if={hasImports} class="freight-line-properties__trade-import">
										import {formatTradeGoods(entry.imported as Partial<Record<string, number>>)}−
										{entry.spentVp} vp
									</span>
								</div>
							)
						}}
					</for>
				</div>
			</InspectorSection>
		</InspectorSection>
	)
}

export default FreightLineProperties
