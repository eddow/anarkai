import { css } from '@app/lib/css'
import {
	freightInspectorGoodOptions,
	freightInspectorTagOptions,
} from '@app/lib/freight-inspector-options'
import {
	applyFreightDraftBayAnchor,
	applyFreightDraftZoneCenter,
	defaultZoneCenterFromAnchorSwitch,
	defaultZoneRadiusForNewZone,
	moveFreightDraftStop,
	removeFreightDraftStop,
	setFreightDraftStopKindAnchor,
	setFreightDraftStopKindZone,
	setFreightDraftStopLoadSelection,
	setFreightDraftStopUnloadSelection,
	setFreightDraftStopZoneRadius,
} from '@app/lib/freight-line-draft'
import { freightMapPick } from '@app/lib/freight-map-pick'
import type {
	FreightLineDefinition,
	FreightStop,
	FreightZoneDefinitionRadius,
} from 'ssh/freight/freight-line'
import { freightLineStationLabel } from 'ssh/freight/freight-line'
import type { GoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import { UNRESTRICTED_GOODS_SELECTION_POLICY } from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game'
import { getTranslator } from '@app/lib/i18n'
import GoodSelectionRulesEditor from './GoodSelectionRulesEditor'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'

css`
.freight-stop-card {
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.55rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 90%, transparent);
	padding: 0.65rem 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}
.freight-stop-card__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	flex-wrap: wrap;
}
.freight-stop-card__title {
	font-size: 0.78rem;
	font-weight: 700;
	color: var(--ak-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.freight-stop-card__toolbar {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	align-items: center;
}
.freight-stop-card__field {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}
.freight-stop-card__label {
	font-size: 0.72rem;
	font-weight: 600;
	color: var(--ak-text-muted);
}
.freight-stop-card__row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.45rem;
	align-items: center;
}
.freight-stop-card__select,
.freight-stop-card__radius {
	padding: 0.3rem 0.45rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	font-size: 0.78rem;
}
.freight-stop-card__mono {
	font-family: ui-monospace, monospace;
	font-size: 0.72rem;
	color: var(--ak-text-muted);
	word-break: break-word;
}
.freight-stop-card__pick-hint {
	font-size: 0.72rem;
	color: var(--ak-accent, #8b5cf6);
}
.freight-stop-card__btn {
	padding: 0.28rem 0.5rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.74rem;
}
.freight-stop-card__btn[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}
`

interface FreightStopCardProps {
	stop: FreightStop
	index: number
	total: number
	game: Game
	lineId: string
	readOnly: boolean
	apply: (fn: (line: FreightLineDefinition) => FreightLineDefinition) => void
}

const stationTileForStop = (game: Game, stop: FreightStop) => {
	if (!('anchor' in stop)) return undefined
	const anchor = stop.anchor
	if (anchor.kind !== 'alveolus') return undefined
	return game.hex.getTile({ q: anchor.coord[0], r: anchor.coord[1] })
}

const stationLabel = (stop: FreightStop): string => {
	if ('anchor' in stop) {
		const anchor = stop.anchor
		return anchor.kind === 'alveolus' ? freightLineStationLabel(anchor) : '—'
	}
	if ('zone' in stop && stop.zone.kind === 'radius') {
		return `zone (${stop.zone.center[0]}, ${stop.zone.center[1]}) r≤${stop.zone.radius}`
	}
	return '—'
}

const FreightStopCard = (props: FreightStopCardProps) => {
	const t = () => getTranslator().line.stopsEditor
	const goods = () => getTranslator().goods
	const goodsTags = () => getTranslator().goodsTags
	const goodOptions = () => freightInspectorGoodOptions(goods())
	const tagOptions = () => freightInspectorTagOptions(goodsTags())
	const loadPolicy = (): GoodSelectionPolicy =>
		props.stop.loadSelection ?? UNRESTRICTED_GOODS_SELECTION_POLICY
	const unloadPolicy = (): GoodSelectionPolicy =>
		props.stop.unloadSelection ?? UNRESTRICTED_GOODS_SELECTION_POLICY
	const tile = () => stationTileForStop(props.game, props.stop)
	const pickPending = () => freightMapPick.pending
	const isBayPickActive = () =>
		pickPending()?.lineId === props.lineId && pickPending()?.pickKind === 'bay' && !props.readOnly
	const isCenterPickActive = () =>
		pickPending()?.lineId === props.lineId &&
		pickPending()?.pickKind === 'center' &&
		!props.readOnly

	const apply = props.apply

	const handleMoveUp = () => {
		if (props.readOnly || props.index <= 0) return
		apply((line) => moveFreightDraftStop(line, props.index, props.index - 1))
	}

	const handleMoveDown = () => {
		if (props.readOnly || props.index >= props.total - 1) return
		apply((line) => moveFreightDraftStop(line, props.index, props.index + 1))
	}

	const handleRemove = () => {
		if (props.readOnly) return
		apply((line) => removeFreightDraftStop(line, props.index))
	}

	const handleKindInput = (value: string) => {
		if (props.readOnly) return
		if (value === 'anchor') {
			apply((line) => setFreightDraftStopKindAnchor(line, props.index))
			return
		}
		apply((line) => {
			const center = defaultZoneCenterFromAnchorSwitch(line, props.index)
			const radius = defaultZoneRadiusForNewZone(line, props.index)
			return setFreightDraftStopKindZone(line, props.index, center, radius)
		})
	}

	const handleStartPickBay = () => {
		if (props.readOnly) return
		freightMapPick.pending = {
			lineId: props.lineId,
			pickKind: 'bay',
			apply: (result) => {
				if (result.kind !== 'bay') return
				apply((line) => applyFreightDraftBayAnchor(line, props.index, result.anchor))
			},
		}
	}

	const handleStartPickCenter = () => {
		if (props.readOnly) return
		freightMapPick.pending = {
			lineId: props.lineId,
			pickKind: 'center',
			apply: (result) => {
				if (result.kind !== 'center') return
				apply((line) => applyFreightDraftZoneCenter(line, props.index, result.coord))
			},
		}
	}

	const handleZoneRadiusInput = (raw: string) => {
		if (props.readOnly) return
		const radius =
			raw.trim() === '' || Number.isNaN(Number(raw)) ? 0 : Math.max(0, Math.floor(Number(raw)))
		apply((line) => setFreightDraftStopZoneRadius(line, props.index, radius))
	}

	const locationKind = () => ('anchor' in props.stop ? 'anchor' : 'zone')
	const radiusZone = (): FreightZoneDefinitionRadius | undefined => {
		const s = props.stop
		if (!('zone' in s)) return undefined
		return s.zone.kind === 'radius' ? s.zone : undefined
	}

	return (
		<div class="freight-stop-card" data-testid={`freight-stop-card-${props.index}`}>
			<div class="freight-stop-card__head">
				<div class="freight-stop-card__title">
					{`${t().stopLabel} ${props.index + 1}`}
				</div>
				<div class="freight-stop-card__toolbar">
					<button
						type="button"
						class="freight-stop-card__btn"
						disabled={props.readOnly || props.index === 0}
						onClick={handleMoveUp}
						aria-label={t().moveUp}
						data-testid={`freight-stop-up-${props.index}`}
					>
						{t().moveUp}
					</button>
					<button
						type="button"
						class="freight-stop-card__btn"
						disabled={props.readOnly || props.index >= props.total - 1}
						onClick={handleMoveDown}
						aria-label={t().moveDown}
						data-testid={`freight-stop-down-${props.index}`}
					>
						{t().moveDown}
					</button>
					<button
						type="button"
						class="freight-stop-card__btn"
						disabled={props.readOnly || props.total <= 1}
						onClick={handleRemove}
						aria-label={t().removeStop}
						data-testid={`freight-stop-remove-${props.index}`}
					>
						{t().removeStop}
					</button>
				</div>
			</div>

			<div class="freight-stop-card__field">
				<span class="freight-stop-card__label">{t().locationKind}</span>
				<div class="freight-stop-card__row">
					<select
						class="freight-stop-card__select"
						disabled={props.readOnly}
						value={locationKind()}
						update:value={handleKindInput}
						data-testid={`freight-stop-kind-${props.index}`}
					>
						<option value="anchor">{t().kindAnchor}</option>
						<option value="zone">{t().kindZone}</option>
					</select>
				</div>
			</div>

			<div class="freight-stop-card__field" if={'anchor' in props.stop}>
				<span class="freight-stop-card__label">{t().anchorLocation}</span>
				<div class="freight-stop-card__row">
					<LinkedEntityControl if={tile()} object={tile()!} />
					<InspectorObjectLink if={tile()} object={tile()!} label={stationLabel(props.stop)} />
					<span if={!tile()} class="freight-stop-card__mono">
						{stationLabel(props.stop)}
					</span>
					<button
						type="button"
						class="freight-stop-card__btn"
						disabled={props.readOnly}
						onClick={handleStartPickBay}
						data-testid={`freight-stop-pick-bay-${props.index}`}
					>
						{t().pickBay}
					</button>
				</div>
				<span if={isBayPickActive()} class="freight-stop-card__pick-hint">
					{t().pickBayPending}
				</span>
			</div>

			<div class="freight-stop-card__field" if={radiusZone()}>
				<span class="freight-stop-card__label">{t().zoneLocation}</span>
				<div class="freight-stop-card__row">
					<span class="freight-stop-card__mono">
						({radiusZone()!.center[0]}, {radiusZone()!.center[1]}) · r≤
						{radiusZone()!.radius}
					</span>
					<button
						type="button"
						class="freight-stop-card__btn"
						disabled={props.readOnly}
						onClick={handleStartPickCenter}
						data-testid={`freight-stop-pick-center-${props.index}`}
					>
						{t().pickCenter}
					</button>
				</div>
				<div class="freight-stop-card__row">
					<span class="freight-stop-card__label">{t().zoneRadius}</span>
					<input
						class="freight-stop-card__radius"
						type="text"
						inputMode="numeric"
						disabled={props.readOnly}
						value={String(radiusZone()!.radius)}
						update:value={handleZoneRadiusInput}
						data-testid={`freight-stop-zone-radius-${props.index}`}
					/>
				</div>
				<span if={isCenterPickActive()} class="freight-stop-card__pick-hint">
					{t().pickCenterPending}
				</span>
			</div>

			<div class="freight-stop-card__field">
				<span class="freight-stop-card__label">{t().unloadPolicy}</span>
				<GoodSelectionRulesEditor
					policy={unloadPolicy()}
					disabled={props.readOnly}
					game={props.game}
					goodOptions={goodOptions()}
					tagOptions={tagOptions()}
					onPolicyChange={(next) =>
						apply((line) => setFreightDraftStopUnloadSelection(line, props.index, next))
					}
				/>
			</div>

			<div class="freight-stop-card__field">
				<span class="freight-stop-card__label">{t().loadPolicy}</span>
				<GoodSelectionRulesEditor
					policy={loadPolicy()}
					disabled={props.readOnly}
					game={props.game}
					goodOptions={goodOptions()}
					tagOptions={tagOptions()}
					onPolicyChange={(next) =>
						apply((line) => setFreightDraftStopLoadSelection(line, props.index, next))
					}
				/>
			</div>
		</div>
	)
}

export default FreightStopCard
