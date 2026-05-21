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
import { isLineFreightVehicleType } from 'ssh/freight/line-freight-vehicles'
import type { Game } from 'ssh/game'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
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

function vehicleCoord(vehicle: VehicleEntity): AxialCoord | undefined {
	const position =
		(vehicle as VehicleEntity & { effectivePosition?: unknown; position?: unknown })
			.effectivePosition ?? (vehicle as VehicleEntity & { position?: unknown }).position
	return position ? toAxialCoord(position) : undefined
}

function vehicleStockSummary(vehicle: VehicleEntity): string {
	const stock = vehicle.storage?.stock ?? {}
	const entries = Object.entries(stock)
		.filter(([, qty]) => (qty ?? 0) > 0)
		.map(([good, qty]) => `${good}:${qty}`)
	return entries.length > 0 ? entries.join(', ') : 'empty'
}

function assignedVehiclesForLine(game: Game | undefined, lineId: string): VehicleEntity[] {
	if (!game?.vehicles) return []
	return [...game.vehicles].filter((vehicle) =>
		vehicle.servedLines?.some((line) => line.id === lineId)
	)
}

function assignableVehicleItems(
	game: Game | undefined,
	lineId: string
): HardListSearchPickerItem[] {
	if (!game?.vehicles) return []
	return [...game.vehicles]
		.filter((vehicle) => isLineFreightVehicleType(vehicle.vehicleType))
		.filter((vehicle) => !vehicle.servedLines?.some((line) => line.id === lineId))
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
		return assignedVehiclesForLine(currentGame(), currentLine()?.id ?? '')
	}
	const availableVehicleItems = () => {
		void local.revision
		return assignableVehicleItems(currentGame(), currentLine()?.id ?? '')
	}

	return (
		<InspectorSection
			title={T.line.section}
			el={{ onMouseenter: handleMouseEnter, onMouseleave: handleMouseLeave }}
		>
			<PropertyGrid>
				<PropertyGridRow if={!isAvailable()}>
					<span class="freight-line-properties__uid">{T.line.unavailable}</span>
				</PropertyGridRow>
				<PropertyGridRow if={isAvailable()}>
					<div class="freight-line-properties__actions">
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
				</PropertyGridRow>
				<PropertyGridRow label={T.line.name}>
					<input
						class="freight-line-properties__name"
						type="text"
						disabled={!isAvailable()}
						value={lineName()}
						onInput={(event) => handleNameInput((event.currentTarget as HTMLInputElement).value)}
						data-testid="freight-line-name"
					/>
				</PropertyGridRow>
				<PropertyGridRow
					if={isAvailable() && issues().length > 0}
					label={T.line.stopsEditor.validation}
				>
					<ul class="freight-line-properties__issues">
						<for each={issues()}>
							{(code: FreightDraftIssueCode) => <li>{issueMessage(code)}</li>}
						</for>
					</ul>
				</PropertyGridRow>
			</PropertyGrid>
			<InspectorSection if={isAvailable()} title={assignmentText().section}>
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
			<FreightStopList
				if={isAvailable() && currentLine() && currentGame()}
				draft={currentLine()!}
				game={currentGame()!}
				readOnly={readOnly()}
				onChange={onLineChange}
			/>
		</InspectorSection>
	)
}

export default FreightLineProperties
