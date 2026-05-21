import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
import type { DockedVehicleEntry } from 'ssh/freight/docked-vehicles'
import type { Game } from 'ssh/game'
import type { GoodType } from 'ssh/types/base'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'

css`
.docked-vehicle-list {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	min-width: 0;
}

.docked-vehicle-list__item {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 16%, transparent);
	border-radius: 0.5rem;
	background: color-mix(in srgb, var(--ak-surface-1) 72%, transparent);
}

.docked-vehicle-list__item-main {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.docked-vehicle-list__meta {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
}

.docked-vehicle-list__cargo-summary {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
	overflow-wrap: anywhere;
}

.docked-vehicle-list__cargo-summary-label {
	font-weight: 600;
	color: var(--ak-text);
}

`

interface DockedVehicleListProps {
	entries: readonly DockedVehicleEntry[]
	showLineMeta?: boolean
	game?: Game
}

const DockedVehicleList = (props: DockedVehicleListProps) => {
	const stopLabel = () => T.line.stop
	const cargoLabel = () => (T.vehicle as typeof T.vehicle & { cargo?: string }).cargo ?? 'Cargo'

	const cargoSummary = (entry: DockedVehicleEntry): string => {
		const stock = entry.vehicle.storage?.stock ?? {}
		const entries = Object.entries(stock)
			.filter((entry): entry is [GoodType, number] => entry[1] > 0)
			.sort(([left], [right]) => left.localeCompare(right))
		if (entries.length === 0) return 'empty'
		return entries.map(([good, qty]) => `${T.goods[good] ?? good} ${qty}`).join(', ')
	}

	return (
		<div class="docked-vehicle-list">
			<for each={props.entries}>
				{(entry) => (
					<div class="docked-vehicle-list__item" data-testid="docked-vehicle-row">
						<div class="docked-vehicle-list__item-main">
							<LinkedEntityControl object={entry.vehicle} />
							<InspectorObjectLink object={entry.vehicle} />
							<span if={props.showLineMeta} class="docked-vehicle-list__meta">
								{entry.line.name} · {stopLabel()} {entry.stop.id}
							</span>
						</div>
						<div
							class="docked-vehicle-list__cargo-summary"
							data-testid="docked-vehicle-cargo-summary"
						>
							<span class="docked-vehicle-list__cargo-summary-label">{cargoLabel()}:</span>{' '}
							{cargoSummary(entry)}
						</div>
					</div>
				)}
			</for>
		</div>
	)
}

export default DockedVehicleList
