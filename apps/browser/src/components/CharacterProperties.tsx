import { css } from '@app/lib/css'
import { effect } from 'mutts'
import { i18nState } from 'ssh/i18n'
import { AEvolutionStep, ALerpStep } from 'ssh/npcs/steps'
import type { Character } from 'ssh/population/character'
import type { GoodType } from 'ssh/types/base'
import GoodsList from './GoodsList'
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
	background-color: var(--pico-secondary-background);
	border-radius: 9999px;
	overflow: hidden;
}

.character-activity__progress-fill {
	height: 0.5rem;
	background-color: var(--pico-muted-color);
	border-radius: 9999px;
}

.character-actions {
	font-size: 0.875rem;
	color: var(--pico-color);
	background-color: var(--pico-card-background-color);
	padding: 0.5rem;
	border-radius: var(--pico-border-radius);
	border: 1px solid var(--pico-border-color);
	list-style: none;
	margin: 0;
}

.character-actions__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.character-actions__item + .character-actions__item {
	margin-top: 0.25rem;
}

.character-actions__empty {
	font-size: 0.875rem;
	color: var(--pico-muted-color);
	background-color: var(--pico-card-background-color);
	padding: 0.5rem;
	border-radius: var(--pico-border-radius);
	border: 1px solid var(--pico-border-color);
	font-style: italic;
}
`

interface CharacterPropertiesProps {
	character: Character
}

const activityBadgeColors: Record<Ssh.ActivityType, string> = {
	walk: 'yellow',
	work: 'red',
	eat: 'green',
	sleep: 'purple',
	rest: 'indigo',
	convey: 'blue',
	idle: 'gray',
	gather: 'pink',
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
		get stepEvolution() {
			return computed.step && !(computed.step instanceof ALerpStep)
				? Math.max(0, Math.min(1, computed.step.evolution))
				: 0
		},
	}

	effect`character-properties:title`(() => {
		scope.setTitle?.(props.character?.title ?? props.character?.name ?? 'Object')
	})

	return (
		<>
			<div if={props.character} class="character-properties">
				<div if={computed.hasTriggerLevels} class="character-properties__stats">
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
				</div>
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
							<span
								class={`badge badge-${activityBadgeColors[props.character?.stepExecutor?.type ?? 'idle'] ?? 'gray'}`}
							>
								{props.character?.stepExecutor?.description
									? (i18nState.translator?.step[props.character.stepExecutor.description] ?? '')
									: (i18nState.translator?.step.idle ?? '')}
							</span>
							<div if={computed.stepEvolution > 0} class="character-activity__progress">
								<div
									class="character-activity__progress-fill"
									style={`width: ${Math.floor(computed.stepEvolution * 100)}%`}
								/>
							</div>
						</div>
					</PropertyGridRow>
					<PropertyGridRow>
						<ul class="character-actions" if={computed.actions.length > 0}>
							<for each={computed.actions}>
								{(description) => (
									<li class="character-actions__item">
										<span>{description}</span>
									</li>
								)}
							</for>
						</ul>
						<div else class="character-actions__empty">
							{i18nState.translator?.character.noActivity ?? ''}
						</div>
					</PropertyGridRow>
				</PropertyGrid>
			</div>
			<div else />
		</>
	)
}

export default CharacterProperties
