import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
import type { DockedVehicleEntry } from 'ssh/freight/docked-vehicles'
import type { Game } from 'ssh/game'
import type { GoodType } from 'ssh/types/base'
import { reactive } from 'mutts'
import GoodsList from './GoodsList'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'

css`
.docked-vehicle-list {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	min-width: 0;
}

.docked-vehicle-list__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	margin-bottom: 0.25rem;
}

.docked-vehicle-list__toggle-label {
	font-size: 0.72rem;
	font-weight: 600;
	color: var(--ak-text-muted);
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

.docked-vehicle-list__content {
	padding-top: 0.25rem;
	border-top: 1px solid color-mix(in srgb, var(--ak-text-muted) 10%, transparent);
}
`

interface DockedVehicleListProps {
	entries: readonly DockedVehicleEntry[]
	showLineMeta?: boolean
	game?: Game
}

const DockedVehicleList = (props: DockedVehicleListProps) => {
	const stopLabel = () => T.line.stop
	const state = reactive({
		showContent: false,
	})

	const vehicleStock = (entry: DockedVehicleEntry): GoodType[] => {
		const stock = entry.vehicle.storage?.stock ?? {}
		return Object.keys(stock).filter((good) => (stock as Record<string, number>)[good] > 0) as GoodType[]
	}

	return (
		<div class="docked-vehicle-list">
			<div class="docked-vehicle-list__header">
				<span class="docked-vehicle-list__toggle-label">{T.vehicle.showContent}</span>
				<input
					type="checkbox"
					checked={state.showContent}
					onChange={() => (state.showContent = !state.showContent)}
					data-testid="docked-vehicle-show-content-toggle"
				/>
			</div>
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
							if={state.showContent && props.game}
							class="docked-vehicle-list__content"
						>
							<GoodsList
								goods={vehicleStock(entry)}
								game={props.game!}
								getBadgeProps={(good) => ({ qty: (entry.vehicle.storage?.stock as Record<string, number>)?.[good] ?? 0 })}
								itemSize={18}
							/>
						</div>
					</div>
				)}
			</for>
		</div>
	)
}

export default DockedVehicleList
