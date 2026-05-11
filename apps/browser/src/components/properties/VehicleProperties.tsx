import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
import {
	presentationRevisionFor,
	workPlanningPresentationRevision,
} from '@app/lib/presentation-events'
import { InspectorSection } from '@app/ui/anarkai'
import { vehicles as vehicleVisuals } from 'engine-pixi/assets/visual-content'
import { vehicleTextureKey } from 'engine-pixi/renderers/vehicle-visual'
import { effect, reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { profile } from 'ssh/dev/debug'
import { createSyntheticFreightLineObject } from 'ssh/freight/freight-line'
import type { ProposedJob } from 'ssh/jobs/offers'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import {
	isVehicleLineService,
	isVehicleMaintenanceService,
	type WorldVehicleType,
} from 'ssh/population/vehicle/vehicle'
import type { GoodType, JobType } from 'ssh/types/base'
import { axial, toAxialCoord } from 'ssh/utils'
import EntityBadge from '../EntityBadge'
import GoodsList from '../GoodsList'
import InspectorObjectLink from '../InspectorObjectLink'
import LinkedEntityControl from '../LinkedEntityControl'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'

css`
.vehicle-properties {
	padding: 0;
}

.vehicle-properties__header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
	margin-bottom: 1rem;
}

.vehicle-properties__linked-object {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.vehicle-properties__service-text {
	font-size: 0.875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
	min-width: 0;
}

.vehicle-properties__status {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.5rem;
	height: 1.5rem;
	border-radius: 9999px;
	border: 1px solid color-mix(in srgb, var(--ak-accent, #8b5cf6) 35%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 12%, var(--ak-surface-panel));
	color: var(--ak-text);
	font-size: 0.8rem;
	font-weight: 700;
	line-height: 1;
}

/* Match CharacterProperties ranked-work rows (operator’s job list). */
.vehicle-work__list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.vehicle-work__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.5rem;
	background-color: color-mix(in srgb, var(--ak-surface-1) 72%, transparent);
}

.vehicle-work__target-control {
	transform: scale(0.88);
	transform-origin: left center;
}

.vehicle-work__content {
	min-width: 0;
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.vehicle-work__item--selected {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 50%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 10%, transparent);
}

.vehicle-work__header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.75rem;
}

.vehicle-work__type {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.vehicle-work__score {
	flex: none;
	font-family: ui-monospace, monospace;
	color: var(--ak-text-muted);
}

.vehicle-work__meta {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
}
`

interface VehiclePropertiesProps {
	vehicle: VehicleEntity
}

interface VehicleWorkChoice {
	jobKind: JobType
	targetLabel: string
	targetTile: Tile
	urgency: number
	jobLabel: string
	metaText: string
}

function resolveVehicleSpriteKey(vehicleType: WorldVehicleType): string {
	const fromVisual = vehicleVisuals[vehicleType]?.sprites?.[0]
	return fromVisual ?? vehicleTextureKey(vehicleType)
}

const rankedWorkLimit = 6

function formatPlannerUtility(value: number): string {
	return value.toFixed(2)
}

function workKindLabel(kind: JobType): string {
	return T.character.plannerWorkKinds[kind] ?? kind
}

function effectiveOperatorForVehicle(vehicle: VehicleEntity | undefined): Character | undefined {
	if (!vehicle) return undefined
	const fromService = vehicle.operator
	if (fromService) return fromService
	const population = vehicle.game.population as Iterable<Character> | undefined
	if (!population?.[Symbol.iterator]) return undefined
	for (const character of population) {
		if (character.operates?.uid === vehicle.uid) return character
	}
	return undefined
}

function describeVehicleWorkTarget(job: ProposedJob): string {
	const targetCoord = toAxialCoord(job.targetTile.position)
	const targetLabel = job.targetTile.title ?? (targetCoord ? axial.key(targetCoord) : '')
	switch (job.job) {
		case 'convey':
			return `convey @ ${targetLabel}`
		case 'vehicleOffload': {
			const detail =
				job.maintenanceKind === 'loadFromBurden' ? job.looseGood.goodType : job.maintenanceKind
			return `vehicleOffload ${detail} @ ${job.targetCoord.q},${job.targetCoord.r}`
		}
		case 'vehicleHop':
			return `vehicleHop ${job.lineId}/${job.stopId} @ ${targetLabel}`
		case 'zoneBrowse':
			return `zoneBrowse ${job.zoneBrowseAction}:${job.goodType} @ ${job.targetCoord.q},${job.targetCoord.r}`
		default:
			return `${job.job} @ ${targetLabel}`
	}
}

function vehicleWorkChoices(vehicle: VehicleEntity | undefined): VehicleWorkChoice[] {
	workPlanningPresentationRevision()
	const end = profile.proposedJobs.begin?.('vehicle-properties.workChoices', () => ({
		vehicleUid: vehicle?.uid,
	}))
	try {
		if (!vehicle) return []
		const advertisedJobs = (
			vehicle as VehicleEntity & {
				readonly advertisedJobs?: readonly ProposedJob[]
			}
		).advertisedJobs
		const jobs = (advertisedJobs ?? vehicle.proposedJobs ?? []) as readonly ProposedJob[]
		return jobs
			.map(
				(job): VehicleWorkChoice => ({
					jobKind: job.job,
					targetLabel: describeVehicleWorkTarget(job),
					targetTile: job.targetTile,
					urgency: job.urgency,
					jobLabel: workKindLabel(job.job),
					metaText: `${T.character.plannerWorkUrgency} ${formatPlannerUtility(job.urgency)}`,
				})
			)
			.sort((a, b) => {
				if (b.urgency !== a.urgency) return b.urgency - a.urgency
				return a.targetLabel.localeCompare(b.targetLabel)
			})
			.slice(0, rankedWorkLimit)
	} finally {
		end?.()
	}
}

const VehicleProperties = (
	props: VehiclePropertiesProps,
	scope: { setTitle?: (title: string) => void }
) => {
	const state = reactive({
		workChoices: [] as VehicleWorkChoice[],
	})
	const computed = {
		get stock() {
			presentationRevisionFor(props.vehicle?.uid)
			return props.vehicle?.storage?.stock ?? {}
		},
		get operator() {
			return effectiveOperatorForVehicle(props.vehicle)
		},
		// TODO: When service is a line, the object should be a "halt" descriptor, with a link to the line and the anchor/zone?
		get lineServiceObject() {
			const svc = props.vehicle?.service
			if (!isVehicleLineService(svc)) return undefined
			return createSyntheticFreightLineObject(props.vehicle.game, svc.line)
		},
		get dockedStatusLabel() {
			const svc = props.vehicle?.service
			if (!isVehicleLineService(svc) || !svc.docked) return ''
			return T.vehicle.docked
		},
		get serviceSummaryText(): string {
			const v = props.vehicle
			if (!v) return ''
			const svc = v.service
			if (!svc) {
				if (effectiveOperatorForVehicle(v)) {
					return T.vehicle.controlledWithoutService
				}
				return T.vehicle.idle
			}
			if (isVehicleLineService(svc)) {
				const docked = svc.docked ? T.vehicle.docked : T.vehicle.underway
				const stopLabel = T.line.stop
				return `${svc.line.name} · ${stopLabel} ${svc.stop.id} · ${docked}`
			}
			if (isVehicleMaintenanceService(svc)) {
				return T.vehicle.offloadService
			}
			return ''
		},
	}

	const resolveWorkTarget = (choice: VehicleWorkChoice) => choice.targetTile

	effect`vehicle-properties:title`(() => {
		scope.setTitle?.(props.vehicle?.title ?? 'Object')
	})

	effect`vehicle-properties:work-choices`(() => {
		state.workChoices = vehicleWorkChoices(props.vehicle)
	})

	return (
		<>
			<div if={props.vehicle} class="vehicle-properties">
				<div class="vehicle-properties__header">
					<EntityBadge
						game={props.vehicle.game}
						sprite={resolveVehicleSpriteKey(props.vehicle.vehicleType)}
						text={props.vehicle.title}
						height={32}
					/>
					<span
						if={computed.dockedStatusLabel}
						class="vehicle-properties__status"
						title={computed.dockedStatusLabel}
						aria-label={computed.dockedStatusLabel}
					>
						●
					</span>
				</div>
				<InspectorSection>
					<PropertyGrid>
						<PropertyGridRow if={computed.operator} label={T.vehicle.operator}>
							<div class="vehicle-properties__linked-object">
								<LinkedEntityControl object={computed.operator!} />
								<InspectorObjectLink object={computed.operator!} />
							</div>
						</PropertyGridRow>
						<PropertyGridRow label={T.goods}>
							<GoodsList
								goods={Object.keys(computed.stock) as GoodType[]}
								game={props.vehicle.game}
								getBadgeProps={(g) => ({ qty: computed.stock[g] })}
							/>
						</PropertyGridRow>
						<PropertyGridRow label={T.vehicle.service}>
							<div if={computed.lineServiceObject} class="vehicle-properties__linked-object">
								<span class="vehicle-properties__service-text">{computed.serviceSummaryText}</span>
								<LinkedEntityControl object={computed.lineServiceObject!} />
								<InspectorObjectLink object={computed.lineServiceObject!} />
							</div>
							<span else class="vehicle-properties__service-text">
								{computed.serviceSummaryText}
							</span>
						</PropertyGridRow>
					</PropertyGrid>
				</InspectorSection>
				<InspectorSection if={state.workChoices.length > 0}>
					<PropertyGrid>
						<PropertyGridRow label={T.character.plannerRankedWork}>
							<div class="vehicle-work__list">
								<for each={state.workChoices}>
									{(choice) => (
										<div class={['vehicle-work__item']} data-testid="vehicle-ranked-work">
											<LinkedEntityControl
												if={resolveWorkTarget(choice)}
												object={resolveWorkTarget(choice)!}
												class="vehicle-work__target-control"
											/>
											<div class="vehicle-work__content">
												<div class="vehicle-work__header">
													<span class="vehicle-work__type">{choice.jobLabel}</span>
													<span class="vehicle-work__score">
														{formatPlannerUtility(choice.urgency)}
													</span>
												</div>
												<div class="vehicle-work__meta">{choice.targetLabel}</div>
												<div class="vehicle-work__meta">{choice.metaText}</div>
											</div>
										</div>
									)}
								</for>
							</div>
						</PropertyGridRow>
					</PropertyGrid>
				</InspectorSection>
			</div>
			<div else />
		</>
	)
}

export default VehicleProperties
