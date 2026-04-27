import { css } from '@app/lib/css'
import { InspectorSection } from '@app/ui/anarkai'
import { Tile } from 'ssh/board/tile'
import { getTranslator } from '@app/lib/i18n'
import {
	collectTileWorkPicks,
	type TileWorkPick,
	tileRankedWorkPicksLimitDefault,
} from 'ssh/tile-work'
import type { JobType } from 'ssh/types/base'
import { axial, toAxialCoord } from 'ssh/utils'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'

css`
.tile-work__list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.tile-work__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.5rem;
	background-color: color-mix(in srgb, var(--ak-surface-1) 72%, transparent);
}

.tile-work__target-control {
	transform: scale(0.88);
	transform-origin: left center;
}

.tile-work__content {
	min-width: 0;
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.tile-work__header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.75rem;
}

.tile-work__type {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tile-work__score {
	flex: none;
	font-family: ui-monospace, monospace;
	color: var(--ak-text-muted);
}

.tile-work__meta {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
}
`

interface TileWorkPropertiesProps {
	tile?: Tile
}

function formatPlannerUtility(value: number): string {
	return value.toFixed(2)
}

function workKindLabel(kind: JobType): string {
	return getTranslator().character.plannerWorkKinds[kind] ?? kind
}

function tileLabel(tile: Tile): string {
	const coord = toAxialCoord(tile.position)
	return tile.title ?? (coord ? axial.key(coord) : '')
}

function describeWorkDetail(choice: TileWorkPick): string {
	const job = choice.job
	switch (job.job) {
		case 'vehicleOffload': {
			const detail =
				job.maintenanceKind === 'loadFromBurden' ? job.looseGood.goodType : job.maintenanceKind
			return `${detail} @ ${job.targetCoord.q},${job.targetCoord.r}`
		}
		case 'vehicleHop':
			return job.targetCoord
				? `${job.lineId}/${job.stopId} @ ${job.targetCoord.q},${job.targetCoord.r}`
				: `${job.lineId}/${job.stopId}`
		case 'zoneBrowse':
			return `${job.zoneBrowseAction}:${job.goodType} @ ${job.targetCoord.q},${job.targetCoord.r}`
		case 'defragment':
			return `${job.goodType} @ ${tileLabel(choice.targetTile)}`
		default:
			return tileLabel(choice.targetTile)
	}
}

const TileWorkProperties = (props: TileWorkPropertiesProps) => {
	const computed = {
		get choices() {
			const game = props.tile?.game
			if (!game || !(props.tile instanceof Tile)) return []
			return collectTileWorkPicks(game, props.tile, tileRankedWorkPicksLimitDefault).map(
				(choice) => ({
					...choice,
					jobLabel: workKindLabel(choice.job.job),
					scoreText: formatPlannerUtility(choice.score),
					detailText: describeWorkDetail(choice),
					metaText: [
						choice.character.title ?? choice.character.name,
						choice.vehicle?.title,
						`${getTranslator().character.plannerWorkUrgency} ${formatPlannerUtility(choice.urgency)}`,
						`${getTranslator().character.plannerWorkPath} ${choice.pathLength}`,
					]
						.filter((text): text is string => !!text)
						.join(' · '),
				})
			)
		},
	}

	return (
		<InspectorSection if={computed.choices.length > 0}>
			<PropertyGrid>
				<PropertyGridRow
					label={getTranslator().character.plannerRankedWork}
				>
					<div class="tile-work__list">
						<for each={computed.choices}>
							{(choice) => (
								<div class="tile-work__item" data-testid="tile-ranked-work">
									<LinkedEntityControl
										object={choice.vehicle ?? choice.character}
										class="tile-work__target-control"
									/>
									<div class="tile-work__content">
										<div class="tile-work__header">
											<span class="tile-work__type">{choice.jobLabel}</span>
											<span class="tile-work__score">{choice.scoreText}</span>
										</div>
										<div class="tile-work__meta">{choice.detailText}</div>
										<div class="tile-work__meta">{choice.metaText}</div>
									</div>
								</div>
							)}
						</for>
					</div>
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default TileWorkProperties
