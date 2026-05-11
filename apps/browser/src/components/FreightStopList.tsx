import { css } from '@app/lib/css'
import {
	freightInspectorGoodOptions,
	freightInspectorTagOptions,
} from '@app/lib/freight-inspector-options'
import {
	addFreightDraftStop,
	applyFreightDraftBayAnchor,
	applyFreightDraftZoneCenter,
	defaultZoneCenterFromAnchorSwitch,
	defaultZoneRadiusForNewZone,
	moveFreightDraftStop,
	removeFreightDraftStop,
	setFreightDraftStopKindAnchor,
	setFreightDraftStopKindNamedZone,
	setFreightDraftStopKindZone,
	setFreightDraftStopLoadSelection,
	setFreightDraftStopNamedZoneId,
	setFreightDraftStopUnloadSelection,
	setFreightDraftStopZoneRadius,
} from '@app/lib/freight-line-draft'
import { hoverFreightLineStop } from '@app/lib/freight-line-overlay'
import { freightMapPick } from '@app/lib/freight-map-pick'
import { T } from '@app/lib/i18n'
import { showZoneObject } from '@app/lib/zone-selection'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { reactive } from 'mutts'
import {
	tablerOutlineMapPin,
	tablerOutlinePencil,
	tablerOutlinePlus,
	tablerOutlineRoute,
	tablerOutlineSettings,
	tablerOutlineTarget,
	tablerOutlineTrash,
} from 'pure-glyf/icons'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { freightLineStationLabel } from 'ssh/freight/freight-line'
import type { GoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import { UNRESTRICTED_GOODS_SELECTION_POLICY } from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game'
import GoodSelectionRulesEditor from './GoodSelectionRulesEditor'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'

css`
.freight-stop-list {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	margin-top: 0.75rem;
	font-size: 0.78rem;
}
.freight-stop-list__table {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;
}
.freight-stop-list__table th {
	text-align: left;
	font-size: 0.68rem;
	text-transform: uppercase;
	color: var(--ak-text-muted);
	padding: 0.25rem 0.35rem;
}
.freight-stop-list__table td {
	padding: 0.35rem;
	border-top: 1px solid color-mix(in srgb, var(--ak-text-muted) 14%, transparent);
	vertical-align: middle;
}
.freight-stop-list__row[data-hovered='true'] {
	background: color-mix(in srgb, var(--ak-accent, #6d8cff) 10%, transparent);
}
.freight-stop-list__row[data-dragging='true'] {
	opacity: 0.55;
}
.freight-stop-list__index {
	width: 2.2rem;
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
}
.freight-stop-list__order-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.85rem;
	height: 1.85rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: grab;
	font-variant-numeric: tabular-nums;
}
.freight-stop-list__order-button:active {
	cursor: grabbing;
}
.freight-stop-list__order-button[disabled] {
	cursor: not-allowed;
	opacity: 0.55;
}
.freight-stop-list__kind {
	width: 7.5rem;
}
.freight-stop-list__location {
	min-width: 0;
}
.freight-stop-list__actions {
	width: 8.25rem;
	text-align: right;
}
.freight-stop-list__select,
.freight-stop-list__input {
	width: 100%;
	box-sizing: border-box;
	padding: 0.25rem 0.35rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	font-size: 0.74rem;
}
.freight-stop-list__location-main {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	min-width: 0;
}
.freight-stop-list__summary {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--ak-text);
}
.freight-stop-list__muted {
	color: var(--ak-text-muted);
}
.freight-stop-list__actions-group {
	display: inline-flex;
	gap: 0.25rem;
	align-items: center;
}
.freight-stop-list__icon-btn,
.freight-stop-list__add {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
}
.freight-stop-list__icon-btn {
	width: 1.85rem;
	height: 1.85rem;
}
.freight-stop-list__icon-btn[disabled],
.freight-stop-list__add[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}
.freight-stop-list__add {
	gap: 0.35rem;
	align-self: flex-start;
	padding: 0.35rem 0.55rem;
	font-size: 0.78rem;
}
.freight-stop-list__policy-row td {
	background: color-mix(in srgb, var(--ak-surface-panel) 86%, transparent);
}
.freight-stop-list__policy-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 0.75rem;
}
`

interface FreightStopListProps {
	draft?: FreightLineDefinition
	game: Game
	readOnly: boolean
	onChange: (next: FreightLineDefinition) => void
}

const icon = (source: string) => renderAnarkaiIcon(source, { size: 15 })

const stationTileForStop = (game: Game, stop: FreightStop) => {
	if (!('anchor' in stop)) return undefined
	const anchor = stop.anchor
	if (anchor.kind !== 'alveolus') return undefined
	return game.hex.getTile({ q: anchor.coord[0], r: anchor.coord[1] })
}

const stopLabel = (game: Game, stop: FreightStop): string => {
	if ('anchor' in stop) return freightLineStationLabel(stop.anchor)
	if (stop.zone.kind === 'named') {
		return game.hex.zoneManager.getZoneDefinition(stop.zone.zoneId)?.name ?? stop.zone.zoneId
	}
	return `(${stop.zone.center[0]}, ${stop.zone.center[1]}) r<=${stop.zone.radius}`
}

const policySummary = (policy: GoodSelectionPolicy | undefined): string => {
	if (!policy) return 'all'
	const rules = policy.goodRules.length + policy.tagRules.length
	return rules === 0 && policy.defaultEffect === 'allow'
		? 'all'
		: `${rules} rules, default ${policy.defaultEffect}`
}

const FreightStopList = (props: FreightStopListProps) => {
	const expanded = reactive({
		byStopId: {} as Record<string, boolean>,
	})
	let dragFrom: number | undefined
	const t = () => T.line.stopsEditor
	const goods = () => T.goods
	const goodsTags = () => T.goodsTags
	const currentDraft = () => props.draft
	const namedZones = () => props.game.hex.zoneManager.listCustomZoneDefinitions()
	const goodOptions = () => freightInspectorGoodOptions(goods())
	const tagOptions = () => freightInspectorTagOptions(goodsTags())
	const stopsIndexed = (): { stop: FreightStop; index: number }[] =>
		(currentDraft()?.stops ?? []).map((stop, index) => ({ stop, index }))

	const apply = (fn: (line: FreightLineDefinition) => FreightLineDefinition) => {
		const draft = currentDraft()
		if (!draft) return
		props.onChange(fn(draft))
	}
	const handleAdd = () => {
		const draft = currentDraft()
		if (props.readOnly || !draft) return
		props.onChange(addFreightDraftStop(draft, draft.stops.length))
	}
	const handleKindInput = (index: number, value: string) => {
		if (props.readOnly) return
		if (value === 'anchor') {
			apply((line) => setFreightDraftStopKindAnchor(line, index))
		} else if (value === 'named') {
			const zoneId = namedZones()[0]?.id
			if (zoneId) apply((line) => setFreightDraftStopKindNamedZone(line, index, zoneId))
		} else {
			apply((line) =>
				setFreightDraftStopKindZone(
					line,
					index,
					defaultZoneCenterFromAnchorSwitch(line, index),
					defaultZoneRadiusForNewZone(line, index)
				)
			)
		}
	}
	const rowKind = (stop: FreightStop) =>
		'anchor' in stop ? 'anchor' : stop.zone.kind === 'named' ? 'named' : 'radius'
	const startPickBay = (index: number) => {
		const lineId = currentDraft()?.id
		if (!lineId || props.readOnly) return
		freightMapPick.pending = {
			lineId,
			pickKind: 'bay',
			apply: (result) => {
				if (result.kind !== 'bay') return
				apply((line) => applyFreightDraftBayAnchor(line, index, result.anchor))
			},
		}
	}
	const startPickCenter = (index: number) => {
		const lineId = currentDraft()?.id
		if (!lineId || props.readOnly) return
		freightMapPick.pending = {
			lineId,
			pickKind: 'center',
			apply: (result) => {
				if (result.kind !== 'center') return
				apply((line) => applyFreightDraftZoneCenter(line, index, result.coord))
			},
		}
	}
	const toggleExpanded = (stopId: string) => {
		expanded.byStopId[stopId] = !expanded.byStopId[stopId]
		apply((line) => ({ ...line }))
	}
	const onDrop = (to: number) => {
		if (props.readOnly || dragFrom === undefined) return
		const from = dragFrom
		dragFrom = undefined
		if (from === to) return
		apply((line) => moveFreightDraftStop(line, from, to))
	}

	return (
		<div class="freight-stop-list">
			<table class="freight-stop-list__table">
				<thead>
					<tr>
						<th class="freight-stop-list__index">#</th>
						<th class="freight-stop-list__kind">{t().locationKind}</th>
						<th>{t().zoneLocation}</th>
						<th class="freight-stop-list__actions">{t().actions}</th>
					</tr>
				</thead>
				<tbody>
					<for each={stopsIndexed()}>
						{({ stop, index }: { stop: FreightStop; index: number }) => {
							const tile = () => stationTileForStop(props.game, stop)
							const expandedPolicy = () => !!expanded.byStopId[stop.id]
							return (
								<>
									<tr
										class="freight-stop-list__row"
										data-testid={`freight-stop-row-${index}`}
										onDragOver={(event) => event.preventDefault()}
										onDrop={() => onDrop(index)}
										onMouseenter={() => hoverFreightLineStop(stop.id)}
										onMouseleave={() => hoverFreightLineStop(undefined)}
									>
										<td class="freight-stop-list__index">
											<button
												type="button"
												class="freight-stop-list__order-button"
												title="Drag to reorder"
												disabled={props.readOnly}
												draggable={!props.readOnly}
												onDragStart={() => {
													dragFrom = index
												}}
											>
												{index + 1}
											</button>
										</td>
										<td class="freight-stop-list__kind">
											<select
												class="freight-stop-list__select"
												disabled={props.readOnly}
												value={rowKind(stop)}
												update:value={(value: string) => handleKindInput(index, value)}
												data-testid={`freight-stop-kind-${index}`}
											>
												<option value="anchor">{t().kindAnchor}</option>
												<option value="radius">{t().kindZone}</option>
												<option value="named">Named zone</option>
											</select>
										</td>
										<td class="freight-stop-list__location">
											<div class="freight-stop-list__location-main">
												<LinkedEntityControl if={tile()} object={tile()!} />
												<InspectorObjectLink if={tile()} object={tile()!} label={stopLabel(props.game, stop)} />
												<span if={!tile()} class="freight-stop-list__summary">
													{stopLabel(props.game, stop)}
												</span>
												<input
													if={'zone' in stop && stop.zone.kind === 'radius'}
													class="freight-stop-list__input"
													type="text"
													inputMode="numeric"
													disabled={props.readOnly}
													value={'zone' in stop && stop.zone.kind === 'radius' ? String(stop.zone.radius) : ''}
													update:value={(raw: string) => {
														const radius =
															raw.trim() === '' || Number.isNaN(Number(raw))
																? 0
																: Math.max(0, Math.floor(Number(raw)))
														apply((line) => setFreightDraftStopZoneRadius(line, index, radius))
													}}
													data-testid={`freight-stop-zone-radius-${index}`}
												/>
												<select
													if={'zone' in stop && stop.zone.kind === 'named'}
													class="freight-stop-list__select"
													disabled={props.readOnly}
													value={'zone' in stop && stop.zone.kind === 'named' ? stop.zone.zoneId : ''}
													update:value={(zoneId: string) =>
														apply((line) => setFreightDraftStopNamedZoneId(line, index, zoneId))
													}
													data-testid={`freight-stop-named-zone-${index}`}
												>
													<for each={namedZones()}>
														{(zone) => <option value={zone.id}>{zone.name?.trim() || zone.id}</option>}
													</for>
												</select>
											</div>
											<div class="freight-stop-list__muted">
												L {policySummary(stop.loadSelection)} / U {policySummary(stop.unloadSelection)}
											</div>
										</td>
										<td class="freight-stop-list__actions">
											<span class="freight-stop-list__actions-group">
												<button
													type="button"
													class="freight-stop-list__icon-btn"
													title={'anchor' in stop ? t().pickBay : t().pickCenter}
													disabled={props.readOnly || ('zone' in stop && stop.zone.kind === 'named')}
													onClick={() => ('anchor' in stop ? startPickBay(index) : startPickCenter(index))}
												>
													{icon('anchor' in stop ? tablerOutlineMapPin : tablerOutlineTarget)}
												</button>
												<button
													type="button"
													class="freight-stop-list__icon-btn"
													title="Open zone"
													disabled={props.readOnly || !('zone' in stop) || stop.zone.kind !== 'named'}
													onClick={() => {
														if ('zone' in stop && stop.zone.kind === 'named') {
															showZoneObject(stop.zone.zoneId)
														}
													}}
												>
													{icon(tablerOutlineRoute)}
												</button>
												<button
													type="button"
													class="freight-stop-list__icon-btn"
													title="Configure policies"
													onClick={() => toggleExpanded(stop.id)}
												>
													{icon(expandedPolicy() ? tablerOutlinePencil : tablerOutlineSettings)}
												</button>
												<button
													type="button"
													class="freight-stop-list__icon-btn"
													title={t().removeStop}
													disabled={props.readOnly || (currentDraft()?.stops.length ?? 0) <= 1}
													onClick={() => apply((line) => removeFreightDraftStop(line, index))}
													data-testid={`freight-stop-remove-${index}`}
												>
													{icon(tablerOutlineTrash)}
												</button>
											</span>
										</td>
									</tr>
									<tr if={expandedPolicy()} class="freight-stop-list__policy-row">
										<td />
										<td colSpan={3}>
											<div class="freight-stop-list__policy-grid">
												<div>
													<div class="freight-stop-list__muted">{t().loadPolicy}</div>
													<GoodSelectionRulesEditor
														policy={stop.loadSelection ?? UNRESTRICTED_GOODS_SELECTION_POLICY}
														disabled={props.readOnly}
														game={props.game}
														goodOptions={goodOptions()}
														tagOptions={tagOptions()}
														onPolicyChange={(next) =>
															apply((line) => setFreightDraftStopLoadSelection(line, index, next))
														}
													/>
												</div>
												<div>
													<div class="freight-stop-list__muted">{t().unloadPolicy}</div>
													<GoodSelectionRulesEditor
														policy={stop.unloadSelection ?? UNRESTRICTED_GOODS_SELECTION_POLICY}
														disabled={props.readOnly}
														game={props.game}
														goodOptions={goodOptions()}
														tagOptions={tagOptions()}
														onPolicyChange={(next) =>
															apply((line) => setFreightDraftStopUnloadSelection(line, index, next))
														}
													/>
												</div>
											</div>
										</td>
									</tr>
								</>
							)
						}}
					</for>
				</tbody>
			</table>
			<button
				type="button"
				class="freight-stop-list__add"
				disabled={props.readOnly}
				onClick={handleAdd}
				data-testid="freight-stop-add"
			>
				{icon(tablerOutlinePlus)}
				{t().addStop}
			</button>
		</div>
	)
}

export default FreightStopList
