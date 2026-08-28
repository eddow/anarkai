import GoodsList from '@app/components/GoodsList'
import { css } from '@app/lib/css'
import { game, interactionMode } from '@app/lib/globals'
import { unnamedZoneOwnership, zoneOverlayState } from '@app/lib/zone-selection'
import { InspectorSection } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { deposits as visualDeposits } from 'engine-rules/visual-content'
import { reactive } from 'mutts'
import {
	tablerOutlineCheck,
	tablerOutlineDimensions,
	tablerOutlineEraser,
	tablerOutlineHexagons,
	tablerOutlinePaint,
	tablerOutlineTrash,
	tablerOutlineX,
} from 'pure-glyf/icons'
import type { ZoneDefinition } from 'ssh/board/zone'
import type { ZoneObject } from 'ssh/board/zone-object'
import { measureZoneTendencies } from 'ssh/commerce/zone-tendencies'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from '../EntityBadge'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'

css`
.zone-properties__input,
.zone-properties__color {
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
}

.zone-properties__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
}

.zone-properties__button {
	padding: 0.35rem 0.55rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.8rem;
}

.zone-properties__button.danger {
	border-color: color-mix(in srgb, var(--ak-danger, #c44) 35%, transparent);
	color: var(--ak-danger, #c44);
}

.zone-properties__button[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}

.zone-properties__button[aria-pressed='true'] {
	border-color: color-mix(in srgb, var(--ak-accent, #6d8cff) 58%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #6d8cff) 16%, var(--ak-surface-panel));
	color: var(--ak-accent, #6d8cff);
}

.zone-properties__deposits {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.zone-properties__stats {
	display: flex;
	flex-wrap: wrap;
	gap: 0.45rem;
	align-items: center;
}

.zone-properties__stat {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	min-height: 1.75rem;
	padding: 0.2rem 0.45rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.4rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 90%, transparent);
	color: var(--ak-text);
	font-variant-numeric: tabular-nums;
}

.zone-properties__stat-icon {
	display: inline-flex;
	color: var(--ak-text-muted);
}

.zone-properties__confirm {
	align-items: center;
}

.zone-properties__confirm-label {
	flex: 1;
	min-width: 0;
	color: var(--ak-danger, #c44);
	font-weight: 600;
	font-size: 0.8rem;
}
`

interface ZonePropertiesProps {
	zoneObject: ZoneObject
	onClose?: () => void
}

const icon = (source: string) => renderAnarkaiIcon(source, { size: 16 })
const hexSideMeters = 3
const hexAreaSquareMeters = (3 * Math.sqrt(3) * hexSideMeters * hexSideMeters) / 2
const formatArea = (tileCount: number) => {
	const area = tileCount * hexAreaSquareMeters
	if (area < 1000) return `${Math.round(area)} m2`
	return `${(area / 10000).toFixed(area < 100000 ? 2 : 1)} ha`
}

/** Paint action token for a custom zone, keyed by its (slugified) name so `applyZoneAction` can resolve it. */
const zonePaintAction = (definition: ZoneDefinition | undefined): string =>
	definition?.name ? `zone:${definition.name}` : ''

const ZoneProperties = (props: ZonePropertiesProps) => {
	const definition = () => props.zoneObject.definition
	const coords = () => (definition() ? game.hex.zoneManager.coordsForZone(definition()!) : [])
	const goodsCounts = () => {
		const counts: Record<string, number> = {}
		for (const coord of coords()) {
			const tile = game.hex.getTile(coord)
			if (!tile) continue
			for (const loose of tile.looseGoods ?? []) {
				if (!loose.available) continue
				counts[loose.goodType] = (counts[loose.goodType] ?? 0) + 1
			}
			for (const [good, qty] of Object.entries(tile.content?.storage?.stock ?? {})) {
				counts[good] = (counts[good] ?? 0) + Number(qty)
			}
		}
		return counts
	}
	const goods = () => Object.keys(goodsCounts()) as GoodType[]
	const depositCounts = () => {
		const counts: Record<string, number> = {}
		for (const coord of coords()) {
			const tile = game.hex.getTile(coord)
			const deposit = tile?.content && 'deposit' in tile.content ? tile.content.deposit : undefined
			const name = typeof deposit?.name === 'string' ? deposit.name : ''
			const amount = typeof deposit?.amount === 'number' ? deposit.amount : undefined
			if (!name || amount === undefined) continue
			counts[name] = (counts[name] ?? 0) + amount
		}
		return counts
	}
	const deposits = () => Object.keys(depositCounts())

	// ── Zone study: the aggregate tendencies the spontaneous spawners accumulate. ──
	const tendencies = () => {
		const def = definition()
		return def ? measureZoneTendencies(game, def) : undefined
	}
	const demandGoods = () => Object.keys(tendencies()?.demand ?? {}) as GoodType[]
	const commerceNeedGoods = () => Object.keys(tendencies()?.commerceNeed ?? {}) as GoodType[]
	const offerGoods = () => Object.keys(tendencies()?.offer ?? {}) as GoodType[]
	const isResidential = () => definition()?.type === 'residential'
	const isCommercial = () => definition()?.type === 'commercial'
	const structureCount = () => {
		const t = tendencies()
		if (!t) return 0
		return t.dwellings + t.underConstruction + t.shops
	}

	const state = reactive({
		confirmingDelete: false,
	})

	const updateZone = (patch: { name?: string; color?: string }) => {
		const existing = definition()
		if (!existing) return
		if (patch.name !== undefined) (existing as { name?: string }).name = patch.name
		if (patch.color !== undefined) (existing as { color?: string }).color = patch.color
		if (patch.name?.trim()) {
			unnamedZoneOwnership.zone = undefined
		}
	}
	const deleteZone = () => {
		const def = definition()
		if (!def) return
		game.hex.zoneManager.removeZoneDefinition(def)
		if (interactionMode.selectedAction === zonePaintAction(def)) interactionMode.selectedAction = ''
		if (unnamedZoneOwnership.zone === def) unnamedZoneOwnership.zone = undefined
		state.confirmingDelete = false
		props.onClose?.()
	}
	const requestDelete = () => {
		state.confirmingDelete = true
	}
	const cancelDelete = () => {
		state.confirmingDelete = false
	}
	const painting = () => interactionMode.selectedAction === zonePaintAction(definition())
	const togglePaint = () => {
		interactionMode.selectedAction = painting() ? '' : zonePaintAction(definition())
	}
	const erasing = () => interactionMode.selectedAction === 'zone:none'
	const toggleErase = () => {
		interactionMode.selectedAction = erasing() ? '' : 'zone:none'
	}
	const applyHover = () => {
		zoneOverlayState.hoveredZone = definition()
	}
	const clearHover = () => {
		if (zoneOverlayState.hoveredZone === definition()) zoneOverlayState.hoveredZone = undefined
	}

	return (
		<InspectorSection
			title={definition()?.name?.trim() || 'Zone'}
			el:onmouseenter={applyHover}
			el:onmousemove={applyHover}
			el:onmouseleave={clearHover}
		>
			<PropertyGrid>
				<PropertyGridRow label="Name">
					<input
						class="zone-properties__input"
						type="text"
						value={definition()?.name ?? ''}
						placeholder="Zone name"
						update:value={(value: string) => updateZone({ name: value })}
						data-testid="zone-name"
					/>
				</PropertyGridRow>
				<PropertyGridRow label="Color">
					<input
						class="zone-properties__color"
						type="color"
						value={definition()?.color ?? '#4f8cff'}
						update:value={(value: string) => updateZone({ color: value })}
						data-testid="zone-color"
					/>
				</PropertyGridRow>
				<PropertyGridRow label="Stats">
					<div class="zone-properties__stats">
						<span
							class="zone-properties__stat"
							title="Tiles"
							aria-label={`${coords().length} tiles`}
							data-testid="zone-stat-tiles"
						>
							<span class="zone-properties__stat-icon" aria-hidden="true">
								{icon(tablerOutlineHexagons)}
							</span>
							<span>{coords().length}</span>
						</span>
						<span
							class="zone-properties__stat"
							title="Area"
							aria-label={`${formatArea(coords().length)} area`}
							data-testid="zone-stat-area"
						>
							<span class="zone-properties__stat-icon" aria-hidden="true">
								{icon(tablerOutlineDimensions)}
							</span>
							<span>{formatArea(coords().length)}</span>
						</span>
					</div>
				</PropertyGridRow>
				<PropertyGridRow if={goods().length > 0} label="Goods">
					<GoodsList
						goods={goods()}
						game={game}
						getBadgeProps={(good) => ({ qty: goodsCounts()[good] ?? 0 })}
					/>
				</PropertyGridRow>
				<PropertyGridRow if={deposits().length > 0} label="Deposits">
					<div class="zone-properties__deposits">
						<for each={deposits()}>
							{(deposit) => {
								const sprite =
									visualDeposits[deposit as keyof typeof visualDeposits]?.sprites?.[0] ?? ''
								return (
									<EntityBadge
										if={sprite}
										game={game}
										height={16}
										sprite={sprite}
										text={deposit}
										qty={depositCounts()[deposit] ?? 0}
									/>
								)
							}}
						</for>
					</div>
				</PropertyGridRow>
				<PropertyGridRow if={structureCount() > 0} label="Structure">
					<div class="zone-properties__stats">
						<span
							if={isResidential() || (tendencies()?.dwellings ?? 0) > 0}
							class="zone-properties__stat"
							title="Dwellings"
							data-testid="zone-stat-dwellings"
						>
							{tendencies()?.dwellings ?? 0} homes
						</span>
						<span
							if={isResidential() || (tendencies()?.underConstruction ?? 0) > 0}
							class="zone-properties__stat"
							title="Under construction"
							data-testid="zone-stat-building"
						>
							{tendencies()?.underConstruction ?? 0} building
						</span>
						<span
							if={isCommercial() || (tendencies()?.shops ?? 0) > 0}
							class="zone-properties__stat"
							title="Shops"
							data-testid="zone-stat-shops"
						>
							{tendencies()?.shops ?? 0} shops
						</span>
					</div>
				</PropertyGridRow>
				<PropertyGridRow if={isResidential()} label="Housing pressure">
					<div class="zone-properties__stats">
						<span
							class="zone-properties__stat"
							title="People nearby minus free dwelling slots"
							data-testid="zone-stat-housing-pressure"
						>
							{tendencies()?.housingPressure ?? 0}
						</span>
					</div>
				</PropertyGridRow>
				<PropertyGridRow if={isCommercial()} label="Shoppers nearby">
					<div class="zone-properties__stats">
						<span
							class="zone-properties__stat"
							title="People within shop sensing radius"
							data-testid="zone-stat-shoppers"
						>
							{tendencies()?.shoppers ?? 0}
						</span>
					</div>
				</PropertyGridRow>
				<PropertyGridRow if={demandGoods().length > 0} label="Demand">
					<GoodsList
						goods={demandGoods()}
						game={game}
						getBadgeProps={(good) => ({ qty: tendencies()?.demand[good] ?? 0 })}
					/>
				</PropertyGridRow>
				<PropertyGridRow if={commerceNeedGoods().length > 0} label="Commerce needed">
					<GoodsList
						goods={commerceNeedGoods()}
						game={game}
						getBadgeProps={(good) => ({ qty: tendencies()?.commerceNeed[good] ?? 0 })}
					/>
				</PropertyGridRow>
				<PropertyGridRow if={offerGoods().length > 0} label="Offer">
					<GoodsList
						goods={offerGoods()}
						game={game}
						getBadgeProps={(good) => ({ qty: tendencies()?.offer[good] ?? 0 })}
					/>
				</PropertyGridRow>
				<PropertyGridRow if={!state.confirmingDelete} label="Actions">
					<div class="zone-properties__actions">
						<button
							type="button"
							class="zone-properties__button"
							title="Paint zone"
							aria-label="Paint zone"
							aria-pressed={painting() ? 'true' : 'false'}
							onClick={togglePaint}
							data-testid="zone-paint"
						>
							{icon(tablerOutlinePaint)}
						</button>
						<button
							type="button"
							class="zone-properties__button danger"
							title="Erase tiles"
							aria-label="Erase tiles"
							aria-pressed={erasing() ? 'true' : 'false'}
							onClick={toggleErase}
							data-testid="zone-erase"
						>
							{icon(tablerOutlineEraser)}
						</button>
						<button
							type="button"
							class="zone-properties__button danger"
							title="Delete zone"
							aria-label="Delete zone"
							onClick={requestDelete}
							data-testid="zone-delete"
						>
							{icon(tablerOutlineTrash)}
						</button>
					</div>
				</PropertyGridRow>
				<PropertyGridRow if={state.confirmingDelete} label="Delete zone">
					<div class="zone-properties__actions zone-properties__confirm">
						<span class="zone-properties__confirm-label">
							Remove this zone ({coords().length} tiles)?
						</span>
						<button
							type="button"
							class="zone-properties__button danger"
							title="Confirm delete"
							aria-label="Confirm delete"
							onClick={deleteZone}
							data-testid="zone-delete-confirm"
						>
							{icon(tablerOutlineCheck)}
						</button>
						<button
							type="button"
							class="zone-properties__button"
							title="Cancel"
							aria-label="Cancel"
							onClick={cancelDelete}
							data-testid="zone-delete-cancel"
						>
							{icon(tablerOutlineX)}
						</button>
					</div>
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default ZoneProperties
