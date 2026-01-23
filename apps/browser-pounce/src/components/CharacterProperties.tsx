import { effect } from 'mutts'
import { AEvolutionStep, ALerpStep } from 'ssh/src/lib/npcs/steps'
import type { Character } from 'ssh/src/lib/population/character'
import { T } from 'ssh/src/lib/i18n'
import { css } from '@app/lib/css'
import type { GoodType } from 'ssh/src/lib/types/base'
import GoodsList from './GoodsList'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import StatProgressBar from './StatProgressBar'
import { compose } from 'pounce-ts'

css`
.character-properties {
	padding: 1rem;
}

.character-properties__stats {
	margin-top: 1rem;
}

.character-properties__stats-grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 1rem;
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

const CharacterProperties = ({ character }: CharacterPropertiesProps, scope: any) => {
	const state = compose(() => ({
		get step() {
			return character.stepExecutor instanceof AEvolutionStep ? character.stepExecutor : undefined
		},
		get goods() {
			return character.carry.stock
		},

		get actions() {
			return Array.isArray(character.actionDescription) ? character.actionDescription : []
		},
	}), (state) => ({
		get stepEvolution() {
			return state.step && !(state.step instanceof ALerpStep)
				? Math.max(0, Math.min(1, state.step.evolution))
				: 0
		}
	}))

	effect(() => {
		scope.setTitle?.(character.title ?? character.name ?? 'Character')
	})

	if (!character.triggerLevels) return null

	return (
		<div class="character-properties">
			{character.triggerLevels && (
				<div class="character-properties__stats">
					<div class="character-properties__stats-grid">
						<StatProgressBar
							value={character.hunger}
							levels={character.triggerLevels.hunger}
							label={T.character.hunger}
						/>
						<StatProgressBar
							value={character.tiredness}
							levels={character.triggerLevels.tiredness}
							label={T.character.tiredness}
						/>
						<StatProgressBar
							value={character.fatigue}
							levels={character.triggerLevels.fatigue}
							label={T.character.fatigue}
						/>
					</div>
				</div>
			)}
			<PropertyGrid>
				<PropertyGridRow label={T.goods}>
					<GoodsList
						goods={Object.keys(state.goods) as GoodType[]}
						game={character.game}
						getBadgeProps={(g) => ({ qty: state.goods[g] })}
					/>
				</PropertyGridRow>
				<Fragment if={character.actions}>
					<PropertyGridRow label={T.character.currentActivity}>
						<div class="character-activity">
							<span
								class={`badge badge-${activityBadgeColors[character.stepExecutor?.type ?? 'idle'] ?? 'gray'}`}
							>
								{character.stepExecutor?.description
									? T.step[character.stepExecutor.description]
									: T.step.idle}
							</span>
							<div if={state.stepEvolution > 0} class="character-activity__progress">
								<div
									class="character-activity__progress-fill"
									style={`width: ${Math.floor(state.stepEvolution * 100)}%`}
								/>
							</div>
						</div>
					</PropertyGridRow>
					<PropertyGridRow>
						<ul class="character-actions" if={state.actions.length > 0}>
							<for each={state.actions}>
								{(description) => (
									<li class="character-actions__item">
										<span>{description}</span>
									</li>
								)}
							</for>
						</ul>
						<div else class="character-actions__empty">
							{T.character.noActivity}
						</div>
					</PropertyGridRow>
				</Fragment>
			</PropertyGrid>
		</div>
	)
}

export default CharacterProperties

