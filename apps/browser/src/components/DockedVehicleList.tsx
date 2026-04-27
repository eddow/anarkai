import { css } from '@app/lib/css'
import type { DockedVehicleEntry } from 'ssh/freight/docked-vehicles'
import { getTranslator } from '@app/lib/i18n'
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
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 16%, transparent);
	border-radius: 0.5rem;
	background: color-mix(in srgb, var(--ak-surface-1) 72%, transparent);
}

.docked-vehicle-list__meta {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
}
`

interface DockedVehicleListProps {
	entries: readonly DockedVehicleEntry[]
	showLineMeta?: boolean
}

const DockedVehicleList = (props: DockedVehicleListProps) => {
	const stopLabel = () => getTranslator().line.stop

	return (
		<div class="docked-vehicle-list">
			<for each={props.entries}>
				{(entry) => (
					<div class="docked-vehicle-list__item" data-testid="docked-vehicle-row">
						<LinkedEntityControl object={entry.vehicle} />
						<InspectorObjectLink object={entry.vehicle} />
						<span if={props.showLineMeta} class="docked-vehicle-list__meta">
							{entry.line.name} · {stopLabel()} {entry.stop.id}
						</span>
					</div>
				)}
			</for>
		</div>
	)
}

export default DockedVehicleList
