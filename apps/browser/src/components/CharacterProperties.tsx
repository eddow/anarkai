import { css } from '@app/lib/css'
import { type AnarkaiBadgeTone, Badge, InspectorSection, Panel } from '@app/ui/anarkai'
import { effect } from 'mutts'
import { i18nState } from 'ssh/i18n'
import { AEvolutionStep, ALerpStep } from 'ssh/npcs/steps'
import type { Character, RankedWorkPlannerSnapshot } from 'ssh/population/character'
import type { NextActivityKind, PlannerFindActionSnapshot } from 'ssh/population/findNextActivity'
import type { GoodType, JobType } from 'ssh/types/base'
import GoodsList from './GoodsList'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import StatProgressBar from './StatProgressBar'

css`/*
.character-properties {
	padding: 0;
}

.character-properties__stats {
	margin-top: 0;
}*/

.character-properties__stats-grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 1px;
}

@media (min-width: 640px) {
	.character-properties__stats-grid {
		grid-template-columns: repeat(2, 1fr);
	}
}

@media (min-width: 1024px) {
	.character-properties__stats-grid {
		grid-template-columns: repeat(3, 1fr);
	}
}

.character-activity {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.character-activity__progress {
	flex: 1;
	height: 0.5rem;
	background-color: var(--ak-surface-1);
	border-radius: 9999px;
	overflow: hidden;
}

.character-activity__progress-fill {
	height: 0.5rem;
	background-color: var(--ak-text-muted);
	border-radius: 9999px;
}

.character-actions {
	font-size: 0.875rem;
}

.character-actions__path {
	display: block;
	max-width: 100%;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	font-family: ui-monospace, monospace;
	color: var(--ak-text-muted);
}

.character-actions__empty {
	font-size: 0.875rem;
	color: var(--ak-text-muted);
	font-style: italic;
}

.character-planner__choices {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.character-planner__choice {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.character-planner__choice-header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.75rem;
}

.character-planner__choice-label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.character-planner__choice-value {
	flex: none;
	font-family: ui-monospace, monospace;
	color: var(--ak-text-muted);
}

.character-planner__choice-track {
	width: 100%;
	height: 0.375rem;
	background-color: var(--ak-surface-1);
	border-radius: 9999px;
	overflow: hidden;
}

.character-planner__choice-fill {
	height: 100%;
	background: linear-gradient(90deg, var(--ak-accent, #8b5cf6), var(--ak-text-muted));
	border-radius: 9999px;
}

.character-work__list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.character-work__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.5rem;
	background-color: color-mix(in srgb, var(--ak-surface-1) 72%, transparent);
}

.character-work__target-control {
	transform: scale(0.88);
	transform-origin: left center;
}

.character-work__content {
	min-width: 0;
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.character-work__item--selected {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 50%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 10%, transparent);
}

.character-work__header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.75rem;
}

.character-work__type {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.character-work__score {
	flex: none;
	font-family: ui-monospace, monospace;
	color: var(--ak-text-muted);
}

.character-work__meta {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
}

.character-planner__mono {
	font-family: ui-monospace, monospace;
	font-size: 0.75rem;
	line-height: 1.35;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--ak-text-muted);
	margin: 0;
}
`

interface CharacterPropertiesProps {
	character: Character
}

const activityBadgeColors: Record<Ssh.ActivityType, AnarkaiBadgeTone> = {
	walk: 'yellow',
	work: 'red',
	eat: 'green',
	sleep: 'purple',
	rest: 'indigo',
	convey: 'blue',
	idle: 'gray',
	gather: 'pink',
}

const plannerChoiceLimit = 6
const rankedWorkLimit = 6

function formatPlannerUtility(value: number): string {
	return value.toFixed(2)
}

function utilityBarPercent(value: number): number {
	return Math.max(0, Math.min(100, value))
}

function summarizeActionPath(actions: string[]): string {
	if (actions.length <= 2) return actions.join(' / ')
	return `${actions[0]} / … / ${actions[actions.length - 1]}`
}

function plannerKindLabel(kind: NextActivityKind): string {
	return i18nState.translator?.character?.plannerKinds?.[kind] ?? kind
}

function workKindLabel(kind: JobType): string {
	return i18nState.translator?.character?.plannerWorkKinds?.[kind] ?? kind
}

const CharacterProperties = (props: CharacterPropertiesProps, scope: any) => {
	const computed = {
		get hasTriggerLevels() {
			return !!props.character?.triggerLevels
		},
		get step() {
			return props.character?.stepExecutor instanceof AEvolutionStep
				? props.character.stepExecutor
				: undefined
		},
		get goods() {
			return props.character?.carry?.stock ?? {}
		},
		get actions() {
			return Array.isArray(props.character?.actionDescription)
				? props.character.actionDescription
				: []
		},
		get actionPathSummary() {
			return summarizeActionPath(computed.actions)
		},
		get stepEvolution() {
			return computed.step && !(computed.step instanceof ALerpStep)
				? Math.max(0, Math.min(1, computed.step.evolution))
				: 0
		},
		get plannerSnapshot(): PlannerFindActionSnapshot | undefined {
			return props.character?.lastPlannerSnapshot
		},
		get workPlannerSnapshot(): RankedWorkPlannerSnapshot | undefined {
			return props.character?.workPlannerSnapshot ?? props.character?.lastWorkPlannerSnapshot
		},
		get plannerChoices() {
			const snap = computed.plannerSnapshot
			if (!snap) return []
			return [...snap.ranked]
				.sort((a, b) => b.utility - a.utility)
				.slice(0, plannerChoiceLimit)
				.map((choice) => ({
					kind: choice.kind,
					label: plannerKindLabel(choice.kind),
					utility: choice.utility,
					utilityText: formatPlannerUtility(choice.utility),
					barPercent: utilityBarPercent(choice.utility),
				}))
		},
		get plannerOutcomeText() {
			const snap = computed.plannerSnapshot
			if (!snap) return ''
			const { kind, source } = snap.outcome
			return `${source} → ${plannerKindLabel(kind)}`
		},
		get workChoices() {
			const snap = computed.workPlannerSnapshot
			if (!snap) return []
			return snap.ranked.slice(0, rankedWorkLimit).map((candidate) => ({
				...candidate,
				jobLabel: workKindLabel(candidate.jobKind),
				scoreText: formatPlannerUtility(candidate.score),
				metaText: [
					`${i18nState.translator?.character?.plannerWorkUrgency ?? 'urgency'} ${formatPlannerUtility(candidate.urgency)}`,
					`${i18nState.translator?.character?.plannerWorkPath ?? 'path'} ${candidate.pathLength}`,
				]
					.filter(Boolean)
					.join(' · '),
			}))
		},
	}

	effect`character-properties:title`(() => {
		scope.setTitle?.(props.character?.title ?? props.character?.name ?? 'Object')
	})

	const resolveWorkTarget = (choice: { targetCoord: { q: number; r: number } }) =>
		props.character?.game?.hex?.getTile(choice.targetCoord)

	return (
		<>
			<div if={props.character} class="character-properties">
				<InspectorSection if={computed.hasTriggerLevels} class="character-properties__stats">
					<div class="character-properties__stats-grid">
						<StatProgressBar
							value={props.character?.hunger ?? 0}
							levels={props.character?.triggerLevels?.hunger}
							label={i18nState.translator?.character.hunger ?? ''}
						/>
						<StatProgressBar
							value={props.character?.tiredness ?? 0}
							levels={props.character?.triggerLevels?.tiredness}
							label={i18nState.translator?.character.tiredness ?? ''}
						/>
						<StatProgressBar
							value={props.character?.fatigue ?? 0}
							levels={props.character?.triggerLevels?.fatigue}
							label={i18nState.translator?.character.fatigue ?? ''}
						/>
					</div>
				</InspectorSection>
				<PropertyGrid>
					<PropertyGridRow label={i18nState.translator?.goods ?? ''}>
						<GoodsList
							goods={Object.keys(computed.goods) as GoodType[]}
							game={props.character?.game}
							getBadgeProps={(g) => ({ qty: computed.goods[g] })}
						/>
					</PropertyGridRow>
					<PropertyGridRow label={i18nState.translator?.character.currentActivity ?? ''}>
						<div class="character-activity">
							<Badge
								tone={activityBadgeColors[props.character?.stepExecutor?.type ?? 'idle'] ?? 'gray'}
							>
								{props.character?.stepExecutor?.description
									? (i18nState.translator?.step[props.character.stepExecutor.description] ?? '')
									: (i18nState.translator?.step.idle ?? '')}
							</Badge>
							<div if={computed.stepEvolution > 0} class="character-activity__progress">
								<div
									class="character-activity__progress-fill"
									style={`width: ${Math.floor(computed.stepEvolution * 100)}%`}
								/>
							</div>
						</div>
					</PropertyGridRow>
					<PropertyGridRow>
						<Panel class="character-actions" if={computed.actions.length > 0}>
							<span
								class="character-actions__path"
								title={computed.actions.join(' / ')}
								data-testid="character-action-path"
							>
								{computed.actionPathSummary}
							</span>
						</Panel>
						<Panel else class="character-actions__empty">
							{i18nState.translator?.character.noActivity ?? ''}
						</Panel>
					</PropertyGridRow>
				</PropertyGrid>
				<InspectorSection class="character-properties__stats">
					<PropertyGrid>
						<PropertyGridRow label={i18nState.translator?.character.plannerSection ?? 'Planning'}>
							<span class="character-planner__mono">
								{i18nState.translator?.character.plannerKeepWorking ?? 'keepWorking'}:{' '}
								{String(props.character?.keepWorking ?? false)}
							</span>
						</PropertyGridRow>
						<PropertyGridRow
							label={i18nState.translator?.character.plannerLastPick ?? 'lastPicked'}
						>
							<span class="character-planner__mono">
								{String(props.character?.lastPickedActivityKind ?? '—')}
							</span>
						</PropertyGridRow>
						<PropertyGridRow label={i18nState.translator?.character.plannerOutcome ?? 'outcome'}>
							<span class="character-planner__mono">{computed.plannerOutcomeText || '—'}</span>
						</PropertyGridRow>
						<PropertyGridRow label={i18nState.translator?.character.plannerRanked ?? 'ranked'}>
							<div if={computed.plannerChoices.length > 0} class="character-planner__choices">
								<for each={computed.plannerChoices}>
									{(choice) => (
										<div
											class="character-planner__choice"
											data-testid="character-planner-choice"
										>
											<div class="character-planner__choice-header">
												<span class="character-planner__choice-label">{choice.label}</span>
												<span class="character-planner__choice-value">{choice.utilityText}</span>
											</div>
											<div class="character-planner__choice-track">
												<div
													class="character-planner__choice-fill"
													style={`width: ${choice.barPercent}%`}
												/>
											</div>
										</div>
									)}
								</for>
							</div>
							<span else class="character-planner__mono">—</span>
						</PropertyGridRow>
						<PropertyGridRow
							if={computed.workChoices.length > 0}
							label={i18nState.translator?.character.plannerRankedWork ?? 'ranked work'}
						>
							<div class="character-work__list">
								<for each={computed.workChoices}>
									{(choice) => (
										<div
											class={[
												'character-work__item',
												choice.selected && 'character-work__item--selected',
											]}
											data-testid="character-ranked-work"
											data-selected={choice.selected ? 'true' : 'false'}
										>
											<LinkedEntityControl
												if={resolveWorkTarget(choice)}
												object={resolveWorkTarget(choice)!}
												class="character-work__target-control"
											/>
											<div class="character-work__content">
												<div class="character-work__header">
													<span class="character-work__type">
														{choice.jobLabel}
													</span>
													<span class="character-work__score">{choice.scoreText}</span>
												</div>
												<div if={!resolveWorkTarget(choice)} class="character-work__meta">
													{choice.targetLabel}
												</div>
												<div class="character-work__meta">{choice.metaText}</div>
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

export default CharacterProperties
