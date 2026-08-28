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
	setFreightDraftStopMinBalanceAfterBuyVp,
	setFreightDraftStopUnloadSelection,
} from '@app/lib/freight-line-draft'
import { hoverFreightLineStop } from '@app/lib/freight-line-overlay'
import {
	activateFreightAddStopPick,
	cancelFreightMapPick,
	freightMapPick,
} from '@app/lib/freight-map-pick'
import { T } from '@app/lib/i18n'
import { getZoneObject } from '@app/lib/zone-selection'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { memoize, reactive } from 'mutts'
import {
	tablerOutlinePencil,
	tablerOutlinePlus,
	tablerOutlineSettings,
	tablerOutlineTrash,
} from 'pure-glyf/icons'
import { goods as visualGoods } from 'engine-rules/visual-content'
import { SettlementTradeObject } from 'ssh/commerce/settlement-trade'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { freightLineStationLabel } from 'ssh/freight/freight-line'
import {
	explainFreightStopCommerce,
	type FreightStopCommerceBlockReason,
	type FreightStopGoodsSnapshot,
} from 'ssh/freight/freight-stop-utility'
import type {
	GoodSelectionEffect,
	GoodSelectionGoodRule,
	GoodSelectionPolicy,
	GoodSelectionTagRule,
} from 'ssh/freight/goods-selection-policy'
import { UNRESTRICTED_GOODS_SELECTION_POLICY } from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import GoodSelectionRulesEditor from './GoodSelectionRulesEditor'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
import ResourceImage from './ResourceImage'

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
.freight-stop-list__table * {
	box-sizing: border-box;
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
	width: 2.4rem;
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
	width: 4.6rem;
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
.freight-stop-list__kind-badge {
	flex: 0 0 auto;
	padding: 0.12rem 0.35rem;
	border-radius: 0.3rem;
	background: color-mix(in srgb, var(--ak-text-muted) 12%, transparent);
	color: var(--ak-text-muted);
	font-size: 0.68rem;
	font-weight: 600;
}
.freight-stop-list__summary {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--ak-text);
}
.freight-stop-list__commerce {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem 0.45rem;
	margin-top: 0.25rem;
	color: var(--ak-text-muted);
	font-size: 0.68rem;
	line-height: 1.35;
}
.freight-stop-list__commerce-item {
	white-space: nowrap;
}
.freight-stop-list__commerce-reason {
	color: color-mix(in srgb, var(--ak-warning, #d8a33f) 82%, var(--ak-text));
}
.freight-stop-list__commerce-retained {
	color: color-mix(in srgb, #22c55e 78%, var(--ak-text));
}
.freight-stop-list__commerce-surplus {
	color: color-mix(in srgb, #f59e0b 78%, var(--ak-text));
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
	flex-wrap: wrap;
}
.freight-stop-list__policy-summary__item {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.15rem 0.4rem;
	border-radius: 0.3rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 30%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 70%, transparent);
	cursor: pointer;
	font: inherit;
}
.freight-stop-list__policy-summary__item--allow {
	border-color: color-mix(in srgb, #22c55e 55%, transparent);
}
.freight-stop-list__policy-summary__item--deny {
	border-color: color-mix(in srgb, #ef4444 55%, transparent);
}
.freight-stop-list__policy-summary__item--expanded {
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--ak-accent, #8b5cf6) 42%, transparent);
}
.freight-stop-list__policy-summary__item[disabled] {
	cursor: default;
	opacity: 0.85;
}
.freight-stop-list__policy-summary__label {
	color: var(--ak-text-muted);
	font-weight: 600;
	font-size: 0.68rem;
}
.freight-stop-list__policy-summary__unrestricted {
	color: var(--ak-text);
	font-size: 0.72rem;
	font-weight: 600;
}
.freight-stop-list__policy-summary__good {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0.1rem;
	border-radius: 0.22rem;
	line-height: 0;
}
.freight-stop-list__policy-summary__effect--allow {
	border: 1px solid color-mix(in srgb, #22c55e 45%, transparent);
	background: color-mix(in srgb, #22c55e 16%, transparent);
}
.freight-stop-list__policy-summary__effect--deny {
	border: 1px solid color-mix(in srgb, #ef4444 45%, transparent);
	background: color-mix(in srgb, #ef4444 16%, transparent);
}
.freight-stop-list__policy-summary__tag {
	padding: 0.05rem 0.3rem;
	border-radius: 0.22rem;
	font-size: 0.66rem;
	font-weight: 600;
}
.freight-stop-list__reserve {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	color: var(--ak-text-muted);
	font-size: 0.68rem;
}
.freight-stop-list__reserve-input {
	width: 4.4rem;
	padding: 0.18rem 0.3rem;
	border-radius: 0.3rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	font-size: 0.68rem;
}
.freight-stop-list__add-panel {
	display: grid;
	grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 1.2fr) auto;
	gap: 0.4rem;
	align-items: end;
	padding: 0.55rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 14%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 88%, transparent);
}
.freight-stop-list__add-field {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	color: var(--ak-text-muted);
	font-size: 0.68rem;
}
.freight-stop-list__add-coords {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 0.3rem;
}
.freight-stop-list__add-actions {
	display: inline-flex;
	gap: 0.25rem;
	justify-content: flex-end;
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
	// Live stops carry the `definition` object; `zoneIndex` is save/load-only.
	return stop.zone.definition ? getZoneObject(stop.zone.definition) : undefined
}

const stopLabel = (stop: FreightStop): string => {
	if ('anchor' in stop) return freightLineStationLabel(stop.anchor)
	if ('trade' in stop) return stop.trade.profile.name
	if (stop.zone.kind === 'named') {
		return stop.zone.definition?.name ?? '(unnamed zone)'
	}
	return `(${stop.zone.center[0]}, ${stop.zone.center[1]}) r<=${stop.zone.radius}`
}

const stopKind = (stop: FreightStop): 'anchor' | 'radius' | 'named' | 'trade' => {
	if ('anchor' in stop) return 'anchor'
	if ('trade' in stop) return 'trade'
	if (stop.zone.kind === 'named') return 'named'
	return 'radius'
}

const stopKindLabel = (stop: FreightStop): string => {
	const kind = stopKind(stop)
	if (kind === 'anchor') return 'Bay'
	if (kind === 'radius') return 'Zone'
	if (kind === 'named') return 'Named'
	return 'Trade'
}

const parseNonNegativeInteger = (raw: string): number | undefined => {
	if (raw.trim() === '' || Number.isNaN(Number(raw))) return undefined
	return Math.max(0, Math.floor(Number(raw)))
}

const formatGoodsSnapshot = (snapshot: FreightStopGoodsSnapshot): string => {
	const entries = Object.entries(snapshot.perGood)
		.filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
		.sort(([left], [right]) => left.localeCompare(right))
	if (entries.length === 0) return 'none'
	return entries
		.map(([good, quantity]) =>
			quantity >= Number.MAX_SAFE_INTEGER ? `${good} available` : `${good} ${quantity}`
		)
		.join(', ')
}

const commerceBlockReasonLabel: Record<FreightStopCommerceBlockReason, string> = {
	no_vehicle: 'no vehicle assigned',
	vehicle_full: 'vehicle full',
	no_downstream_demand: 'no downstream demand',
	buffer_full: 'buffer full',
	no_matching_settlement_offer: 'no matching settlement offer',
	reserve_blocks_import: 'reserve blocks import',
	policy_blocks_good: 'policy blocks good',
}

const commerceReasonText = (
	reasons: readonly FreightStopCommerceBlockReason[],
	vehicleCount?: number,
	vehicleLabel?: string
): string => {
	if (reasons.length === 0) return 'ready'
	return reasons
		.map((reason) => {
			if (reason === 'vehicle_full' && vehicleCount !== undefined && vehicleCount > 1) {
				return vehicleLabel ? `${vehicleLabel} full` : `all ${vehicleCount} vehicles full`
			}
			return commerceBlockReasonLabel[reason] ?? reason
		})
		.join(', ')
}

const tradeStopCanImport = (stop: FreightStop): boolean => {
	if (!('trade' in stop)) return false
	return stop.trade.profile.offers.some((offer) => offer.direction === 'sell')
}

const goodSprite = (goodType: string) => visualGoods[goodType]?.sprites?.[0]

const PolicySummary = (props: {
	policy: GoodSelectionPolicy | undefined
	label: string
	game: Game
	disabled?: boolean
	expanded?: boolean
	onToggle?: () => void
}) => {
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
	const effectClass = (effect: GoodSelectionEffect) =>
		effect === 'allow'
			? 'freight-stop-list__policy-summary__effect--allow'
			: 'freight-stop-list__policy-summary__effect--deny'
	const summaryText = () => {
		const r = rules()
		if (isUnrestricted()) return 'All goods allowed'
		const parts: string[] = []
		if (r.goodRules.length > 0) {
			const allowGoods = r.goodRules
				.filter((rule) => rule.effect === 'allow')
				.map((rule) => rule.goodType)
			const denyGoods = r.goodRules
				.filter((rule) => rule.effect === 'deny')
				.map((rule) => rule.goodType)
			if (allowGoods.length > 0) parts.push(`+${allowGoods.length} goods`)
			if (denyGoods.length > 0) parts.push(`-${denyGoods.length} goods`)
		}
		if (r.tagRules.length > 0) {
			const allowTags = r.tagRules.filter((rule) => rule.effect === 'allow').length
			const denyTags = r.tagRules.filter((rule) => rule.effect === 'deny').length
			if (allowTags > 0) parts.push(`+${allowTags} tags`)
			if (denyTags > 0) parts.push(`-${denyTags} tags`)
		}
		if (parts.length === 0) return r.defaultEffect === 'allow' ? 'All goods allowed' : 'Deny all'
		return parts.join(', ')
	}
	return (
		<button
			type="button"
			class={[
				'freight-stop-list__policy-summary__item',
				`freight-stop-list__policy-summary__item--${rules().defaultEffect}`,
				props.expanded ? 'freight-stop-list__policy-summary__item--expanded' : '',
			]}
			disabled={props.disabled}
			onClick={props.onToggle}
			title={`${props.label}: ${summaryText()}`}
		>
			<span class="freight-stop-list__policy-summary__label">{props.label}</span>
			<span if={isUnrestricted()} class="freight-stop-list__policy-summary__unrestricted">
				∞
			</span>
			<for each={rules().goodRules}>
				{(rule: GoodSelectionGoodRule) => (
					<span
						class={['freight-stop-list__policy-summary__good', effectClass(rule.effect)]}
						title={`${rule.goodType}: ${rule.effect}`}
					>
						<ResourceImage
							game={props.game}
							sprite={goodSprite(rule.goodType)}
							width={12}
							height={12}
							alt={rule.goodType}
						/>
					</span>
				)}
			</for>
			<for each={rules().tagRules}>
				{(rule: GoodSelectionTagRule) => (
					<span
						class={['freight-stop-list__policy-summary__tag', effectClass(rule.effect)]}
						title={`tag ${rule.tag} (${rule.match}): ${rule.effect}`}
					>
						#{rule.tag}
					</span>
				)}
			</for>
		</button>
	)
}

const FreightStopList = (props: FreightStopListProps) => {
	const expandedStops = reactive(new Set<number>())
	const toggleExpanded = (index: number) => {
		if (expandedStops.has(index)) expandedStops.delete(index)
		else expandedStops.add(index)
	}
	let dragFrom: number | undefined
	const t = () => T.line.stopsEditor
	const goods = () => T.goods
	const goodsTags = () => T.goodsTags
	const currentDraft = () => props.draft
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
	const reserveDefault = () => props.game.procurementDefaults?.bufferPurchaseReserveVp ?? 0
	const addPickActive = () => {
		const draft = currentDraft()
		return (
			!!draft &&
			freightMapPick.pending?.line === draft &&
			freightMapPick.pending.pickKind === 'add-stop'
		)
	}
	const toggleAddStopPick = () => {
		const draft = currentDraft()
		if (props.readOnly || !draft) return
		if (addPickActive()) {
			cancelFreightMapPick()
			return
		}
		activateFreightAddStopPick({
			line: draft,
			apply: (stop) => {
				const line = currentDraft()
				if (!line) return
				props.onChange(addFreightDraftStop(line, line.stops.length, stop))
			},
		})
	}
	const onDrop = (to: number) => {
		if (props.readOnly || dragFrom === undefined) return
		const from = dragFrom
		dragFrom = undefined
		if (from === to) return
		apply((line) => moveFreightDraftStop(line, from, to))
	}
	const handleStopReserveInput = (index: number, raw: string) => {
		apply((line) =>
			setFreightDraftStopMinBalanceAfterBuyVp(line, index, parseNonNegativeInteger(raw))
		)
	}
	const vehiclesForLine = (): Vehicle[] => {
		const draft = currentDraft()
		const vehicles = (props.game as { vehicles?: Iterable<Vehicle> }).vehicles
		if (!draft || !vehicles) return []
		const out: Vehicle[] = []
		for (const vehicle of vehicles) {
			if (vehicle.servedLines.some((line) => line === draft)) out.push(vehicle)
		}
		return out
	}
	const commerceForStop = (index: number) => {
		const line = currentDraft()!
		const vehicles = vehiclesForLine()
		if (vehicles.length === 0) {
			return {
				explanation: explainFreightStopCommerce({
					game: props.game,
					line,
					stopIndex: index,
				}),
				vehicleLabel: undefined as string | undefined,
				vehicleCount: 0,
			}
		}
		const explanations = vehicles.map((vehicle) => ({
			vehicle,
			explanation: explainFreightStopCommerce({
				game: props.game,
				line,
				stopIndex: index,
				vehicle,
			}),
		}))
		explanations.sort((a, b) => {
			const aOpportunity =
				a.explanation.importOpportunityGoods.total + a.explanation.exportOpportunityGoods.total
			const bOpportunity =
				b.explanation.importOpportunityGoods.total + b.explanation.exportOpportunityGoods.total
			if (aOpportunity !== bOpportunity) return bOpportunity - aOpportunity
			return a.explanation.blockReasons.length - b.explanation.blockReasons.length
		})
		const best = explanations[0]!
		return {
			explanation: best.explanation,
			vehicleLabel: vehicles.length === 1 ? best.vehicle.title : undefined,
			vehicleCount: vehicles.length,
		}
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
							const tradeObj = () =>
								'trade' in stop
									? new SettlementTradeObject(props.game, stop.trade.profile)
									: undefined
							const expandedPolicy = () => expandedStops.has(index)
							const commerce = () => commerceForStop(index)
							const commerceExpl = () => commerce().explanation
							const commerceCtx = () => ({
								vehicleCount: commerce().vehicleCount,
								vehicleLabel: commerce().vehicleLabel,
							})
							return (
								<>
									<tr
										class="freight-stop-list__row"
										data-testid={`freight-stop-row-${index}`}
										onDragOver={(event) => event.preventDefault()}
										onDrop={() => onDrop(index)}
										onMouseenter={() => hoverFreightLineStop(stop)}
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
												<span
													class="freight-stop-list__kind-badge"
													data-testid={`freight-stop-kind-label-${index}`}
												>
													{stopKindLabel(stop)}
												</span>
												<LinkedEntityControl if={tile()} object={tile()!} />
												<InspectorObjectLink if={tile()} object={tile()!} label={stopLabel(stop)} />
												<LinkedEntityControl if={zoneObj()} object={zoneObj()!} />
												<InspectorObjectLink
													if={zoneObj()}
													object={zoneObj()!}
													label={stopLabel(stop)}
												/>
												<LinkedEntityControl if={tradeObj()} object={tradeObj()!} />
												<InspectorObjectLink
													if={tradeObj()}
													object={tradeObj()!}
													label={stopLabel(stop)}
												/>
												<span
													if={!tile() && !zoneObj() && !tradeObj()}
													class="freight-stop-list__summary"
												>
													{stopLabel(stop)}
												</span>
											</div>
											<div class="freight-stop-list__commerce">
												<span class="freight-stop-list__commerce-item">
													{commerceExpl().servicePosition.label}
													{commerceExpl().servicePosition.borderCount !== undefined
														? ` (${commerceExpl().servicePosition.borderCount})`
														: ''}
												</span>
												<span class="freight-stop-list__commerce-item">
													demand {formatGoodsSnapshot(commerceExpl().downstreamDemandGoods)}
												</span>
												<span class="freight-stop-list__commerce-item">
													provides {formatGoodsSnapshot(commerceExpl().localProvidedGoods)}
												</span>
												<span class="freight-stop-list__commerce-item">
													needs {formatGoodsSnapshot(commerceExpl().localNeededGoods)}
												</span>
												<span class="freight-stop-list__commerce-item">
													import {formatGoodsSnapshot(commerceExpl().importOpportunityGoods)}
												</span>
												<span class="freight-stop-list__commerce-item">
													export {formatGoodsSnapshot(commerceExpl().exportOpportunityGoods)}
												</span>
												<span
													if={commerceExpl().retainedCargoGoods.total > 0}
													class="freight-stop-list__commerce-item freight-stop-list__commerce-retained"
												>
													retained {formatGoodsSnapshot(commerceExpl().retainedCargoGoods)}
												</span>
												<span
													if={commerceExpl().surplusCargoGoods.total > 0}
													class="freight-stop-list__commerce-item freight-stop-list__commerce-surplus"
												>
													surplus {formatGoodsSnapshot(commerceExpl().surplusCargoGoods)}
												</span>
												<span class="freight-stop-list__commerce-item freight-stop-list__commerce-reason">
													{commerceReasonText(
														commerceExpl().blockReasons,
														commerceCtx().vehicleCount,
														commerceCtx().vehicleLabel
													)}
												</span>
											</div>
										</td>
										<td class="freight-stop-list__policies">
											<div class="freight-stop-list__policy-summary">
												<PolicySummary
													policy={stop.loadSelection}
													label="L"
													game={props.game}
													disabled={props.readOnly}
													expanded={expandedPolicy()}
													onToggle={() => toggleExpanded(index)}
												/>
												<PolicySummary
													policy={stop.unloadSelection}
													label="U"
													game={props.game}
													disabled={props.readOnly}
													expanded={expandedPolicy()}
													onToggle={() => toggleExpanded(index)}
												/>
												<label if={tradeStopCanImport(stop)} class="freight-stop-list__reserve">
													Reserve
													<input
														class="freight-stop-list__reserve-input"
														type="text"
														inputMode="numeric"
														disabled={props.readOnly}
														value={String(stop.minBalanceAfterBuyVp ?? reserveDefault())}
														update:value={(raw: string) => handleStopReserveInput(index, raw)}
														data-testid={`freight-stop-min-balance-${index}`}
													/>
												</label>
											</div>
										</td>
										<td class="freight-stop-list__actions">
											<span class="freight-stop-list__actions-group">
												<button
													type="button"
													class="freight-stop-list__icon-btn"
													title="Configure policies"
													onClick={() => toggleExpanded(index)}
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
				aria-pressed={addPickActive() ? 'true' : 'false'}
				disabled={props.readOnly}
				onClick={toggleAddStopPick}
				data-testid="freight-stop-add"
			>
				{icon(tablerOutlinePlus)}
				{t().addStop}
			</button>
		</div>
	)
}

export default FreightStopList
