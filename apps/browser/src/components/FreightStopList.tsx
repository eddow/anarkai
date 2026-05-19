import { css } from '@app/lib/css'
import {
	freightInspectorGoodOptions,
	freightInspectorTagOptions,
} from '@app/lib/freight-inspector-options'
import {
	addFreightDraftStop,
	moveFreightDraftStop,
	removeFreightDraftStop,
	setFreightDraftStopLoadSelection,
	setFreightDraftStopNamedZoneId,
	setFreightDraftStopUnloadSelection,
	setFreightDraftStopZoneRadius,
} from '@app/lib/freight-line-draft'
import { hoverFreightLineStop } from '@app/lib/freight-line-overlay'
import { T } from '@app/lib/i18n'
import { getZoneObject } from '@app/lib/zone-selection'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { memoize, reactive } from 'mutts'
import {
	tablerOutlineCheck,
	tablerOutlinePencil,
	tablerOutlinePlus,
	tablerOutlineSettings,
	tablerOutlineTrash,
	tablerOutlineX,
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
	width: 2rem;
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
}
.freight-stop-list__order-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.7rem;
	height: 1.7rem;
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
.freight-stop-list__policies {
	width: auto;
	min-width: 8rem;
}
.freight-stop-list__location {
	min-width: 0;
}
.freight-stop-list__actions {
	width: auto;
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
	white-space: nowrap;
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
	width: 1.7rem;
	height: 1.7rem;
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
.freight-stop-list__policy-summary {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.72rem;
}
.freight-stop-list__policy-summary__item {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.15rem 0.4rem;
	border-radius: 0.3rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 70%, transparent);
}
.freight-stop-list__policy-summary__label {
	color: var(--ak-text-muted);
	font-weight: 600;
}
.freight-stop-list__policy-summary__icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.1rem;
	height: 1.1rem;
	border-radius: 0.25rem;
	font-size: 0.7rem;
}
.freight-stop-list__policy-summary__icon--allow {
	background: color-mix(in srgb, #22c55e 20%, transparent);
	color: #22c55e;
}
.freight-stop-list__policy-summary__icon--deny {
	background: color-mix(in srgb, #ef4444 20%, transparent);
	color: #ef4444;
}
.freight-stop-list__policy-summary__text {
	color: var(--ak-text);
	font-size: 0.68rem;
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

const zoneObjectForStop = (stop: FreightStop) => {
	if (!('zone' in stop) || stop.zone.kind !== 'named') return undefined
	return getZoneObject(stop.zone.zoneId)
}

const stopLabel = (game: Game, stop: FreightStop): string => {
	if ('anchor' in stop) return freightLineStationLabel(stop.anchor)
	if (stop.zone.kind === 'named') {
		return game.hex.zoneManager.getZoneDefinition(stop.zone.zoneId)?.name ?? stop.zone.zoneId
	}
	return `(${stop.zone.center[0]}, ${stop.zone.center[1]}) r<=${stop.zone.radius}`
}

const PolicySummary = (props: { policy: GoodSelectionPolicy | undefined; label: string }) => {
	const policy = () => props.policy
	const rules = () => {
		const p = policy()
		if (!p) return { goodRules: [], tagRules: [], defaultEffect: 'allow' as const }
		return {
			goodRules: p.goodRules,
			tagRules: p.tagRules,
			defaultEffect: p.defaultEffect,
		}
	}
	const isUnrestricted = () => {
		const r = rules()
		return r.goodRules.length === 0 && r.tagRules.length === 0 && r.defaultEffect === 'allow'
	}
	const defaultIcon = () => {
		const r = rules()
		return r.defaultEffect === 'allow' ? icon(tablerOutlineCheck) : icon(tablerOutlineX)
	}
	const summaryText = () => {
		const r = rules()
		if (isUnrestricted()) return 'All goods'
		const parts: string[] = []
		if (r.goodRules.length > 0) {
			const allowGoods = r.goodRules
				.filter((rule) => rule.effect === 'allow')
				.map((rule) => rule.goodType)
			const denyGoods = r.goodRules
				.filter((rule) => rule.effect === 'deny')
				.map((rule) => rule.goodType)
			if (allowGoods.length > 0) parts.push(`+${allowGoods.length}`)
			if (denyGoods.length > 0) parts.push(`-${denyGoods.length}`)
		}
		if (r.tagRules.length > 0) {
			const allowTags = r.tagRules.filter((rule) => rule.effect === 'allow').length
			const denyTags = r.tagRules.filter((rule) => rule.effect === 'deny').length
			if (allowTags > 0) parts.push(`+${allowTags} tags`)
			if (denyTags > 0) parts.push(`-${denyTags} tags`)
		}
		if (parts.length === 0) return r.defaultEffect === 'allow' ? 'All goods' : 'Deny all'
		return parts.join(', ')
	}
	return (
		<span
			class="freight-stop-list__policy-summary__item"
			title={
				isUnrestricted()
					? `${props.label}: All goods allowed`
					: `${props.label}: ${summaryText()}, default ${rules().defaultEffect}`
			}
		>
			<span class="freight-stop-list__policy-summary__label">{props.label}</span>
			<span
				class={`freight-stop-list__policy-summary__icon ${
					rules().defaultEffect === 'allow'
						? 'freight-stop-list__policy-summary__icon--allow'
						: 'freight-stop-list__policy-summary__icon--deny'
				}`}
			>
				{isUnrestricted() ? '∞' : defaultIcon()}
			</span>
			<span class="freight-stop-list__policy-summary__text">{summaryText()}</span>
		</span>
	)
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
	const stopsIndexed = memoize((): { stop: FreightStop; index: number }[] => {
		const draft = currentDraft()
		if (!draft) return []
		void draft.stops.length
		return draft.stops.map((stop, index) => ({ stop, index }))
	})

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
						<th>{t().zoneLocation}</th>
						<th class="freight-stop-list__policies">{t().policies}</th>
						<th class="freight-stop-list__actions">{t().actions}</th>
					</tr>
				</thead>
				<tbody>
					<for each={stopsIndexed()}>
						{({ stop, index }: { stop: FreightStop; index: number }) => {
							const tile = () => stationTileForStop(props.game, stop)
							const zoneObj = () => zoneObjectForStop(stop)
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
										<td class="freight-stop-list__location">
											<div class="freight-stop-list__location-main">
												<LinkedEntityControl if={tile()} object={tile()!} />
												<InspectorObjectLink
													if={tile()}
													object={tile()!}
													label={stopLabel(props.game, stop)}
												/>
												<LinkedEntityControl if={zoneObj()} object={zoneObj()!} />
												<InspectorObjectLink
													if={zoneObj()}
													object={zoneObj()!}
													label={stopLabel(props.game, stop)}
												/>
												<span if={!tile() && !zoneObj()} class="freight-stop-list__summary">
													{stopLabel(props.game, stop)}
												</span>
												<input
													if={'zone' in stop && stop.zone.kind === 'radius'}
													class="freight-stop-list__input"
													type="text"
													inputMode="numeric"
													disabled={props.readOnly}
													value={
														'zone' in stop && stop.zone.kind === 'radius'
															? String(stop.zone.radius)
															: ''
													}
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
													value={
														'zone' in stop && stop.zone.kind === 'named' ? stop.zone.zoneId : ''
													}
													update:value={(zoneId: string) =>
														apply((line) => setFreightDraftStopNamedZoneId(line, index, zoneId))
													}
													data-testid={`freight-stop-named-zone-${index}`}
												>
													<for each={namedZones()}>
														{(zone) => (
															<option value={zone.id}>{zone.name?.trim() || zone.id}</option>
														)}
													</for>
												</select>
											</div>
										</td>
										<td class="freight-stop-list__policies">
											<div class="freight-stop-list__policy-summary">
												<PolicySummary policy={stop.loadSelection} label="L" />
												<PolicySummary policy={stop.unloadSelection} label="U" />
											</div>
										</td>
										<td class="freight-stop-list__actions">
											<span class="freight-stop-list__actions-group">
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
										<td colSpan={2}>
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
