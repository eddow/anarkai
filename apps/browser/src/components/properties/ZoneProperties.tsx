import GoodsList from '@app/components/GoodsList'
import { css } from '@app/lib/css'
import { bumpSelectionTitleVersion, game, interactionMode } from '@app/lib/globals'
import { unnamedZoneOwnership, zoneOverlayState } from '@app/lib/zone-selection'
import { InspectorSection } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { deposits as visualDeposits } from 'engine-pixi/assets/visual-content'
import { effect } from 'mutts'
import {
	tablerOutlineDimensions,
	tablerOutlineHexagons,
	tablerOutlinePaint,
	tablerOutlineTrash,
} from 'pure-glyf/icons'
import type { ZoneObject } from 'ssh/board/zone-object'
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

const ZoneProperties = (props: ZonePropertiesProps) => {
	const zoneId = () => props.zoneObject.zoneId
	const definition = () => game.hex.zoneManager.getZoneDefinition(zoneId())
	const coords = () => game.hex.zoneManager.coordsForZone(zoneId())
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

	effect`zone-properties:overlay`(() => {
		return () => {
			const owned = unnamedZoneOwnership.zoneId
			const ownedDefinition = owned ? game.hex.zoneManager.getZoneDefinition(owned) : undefined
			if (owned === zoneId() && ownedDefinition && !ownedDefinition.name.trim()) {
				game.hex.zoneManager.removeNamedZone(owned)
				unnamedZoneOwnership.zoneId = undefined
				unnamedZoneOwnership.panelId = undefined
				bumpSelectionTitleVersion()
			}
		}
	})

	const updateZone = (patch: { name?: string; color?: string }) => {
		const existing = definition()
		if (!existing) return
		game.hex.zoneManager.defineZone({
			id: existing.id,
			name: patch.name ?? existing.name,
			color: patch.color ?? existing.color,
			builtIn: existing.builtIn,
		})
		if (patch.name?.trim()) {
			unnamedZoneOwnership.zoneId = undefined
			unnamedZoneOwnership.panelId = undefined
		}
		bumpSelectionTitleVersion()
	}
	const deleteZone = () => {
		const existing = definition()
		if (!existing || existing.builtIn) return
		game.hex.zoneManager.removeNamedZone(existing.id)
		if (interactionMode.selectedAction === `zone:${existing.id}`)
			interactionMode.selectedAction = ''
		bumpSelectionTitleVersion()
		props.onClose?.()
	}
	const painting = () => interactionMode.selectedAction === `zone:${zoneId()}`
	const togglePaint = () => {
		interactionMode.selectedAction = painting() ? '' : `zone:${zoneId()}`
	}
	const applyHover = () => {
		zoneOverlayState.hoveredZoneId = zoneId()
	}
	const clearHover = () => {
		if (zoneOverlayState.hoveredZoneId === zoneId()) zoneOverlayState.hoveredZoneId = undefined
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
				<PropertyGridRow label="Actions">
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
							title="Delete zone"
							aria-label="Delete zone"
							disabled={!!definition()?.builtIn}
							onClick={deleteZone}
							data-testid="zone-delete"
						>
							{icon(tablerOutlineTrash)}
						</button>
					</div>
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default ZoneProperties
