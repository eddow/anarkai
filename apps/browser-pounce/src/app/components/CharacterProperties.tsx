import { effect, reactive } from 'mutts'
import { AEvolutionStep, ALerpStep } from '$lib/game/npcs/steps'
import type { Character } from '$lib/game/population/character'
import { T } from '$lib/i18n'
import { css } from '$lib/css'
import GoodsList from './GoodsList'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import StatProgressBar from './StatProgressBar'

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

const CharacterProperties = ({ character }: CharacterPropertiesProps) => {
	const state = reactive({
		actions: [] as string[],
		hunger: 0,
		tiredness: 0,
		fatigue: 0,
		triggerLevels: undefined as Character['triggerLevels'] | undefined,
		stepType: undefined as Ssh.ActivityType | undefined,
		stepDescription: undefined as string | undefined,
		step: undefined as AEvolutionStep | undefined,
		goods: {} as Record<string, number>,
	})

	effect(() => {
		const actions = character.actionDescription
		state.actions = Array.isArray(actions) ? actions : []
	})

	effect(() => {
		state.hunger = character.hunger
		state.tiredness = character.tiredness
		state.fatigue = character.fatigue
		state.triggerLevels = character.triggerLevels
		const stepExecutor = character.stepExecutor
		state.stepType = stepExecutor?.type as Ssh.ActivityType | undefined
		state.stepDescription = stepExecutor?.description || undefined
		state.step = stepExecutor instanceof AEvolutionStep ? stepExecutor : undefined
		state.goods = character.carry.stock
	})

	const stepEvolution =
		state.step && !(state.step instanceof ALerpStep)
			? Math.max(0, Math.min(1, state.step.evolution))
			: 0

	if (!state.triggerLevels) return null

	return (
		<div class="character-properties">
			{state.triggerLevels && (
				<div class="character-properties__stats">
					<div class="character-properties__stats-grid">
						<StatProgressBar
							value={state.hunger}
							levels={state.triggerLevels.hunger}
							label={T.character.hunger}
						/>
						<StatProgressBar
							value={state.tiredness}
							levels={state.triggerLevels.tiredness}
							label={T.character.tiredness}
						/>
						<StatProgressBar
							value={state.fatigue}
							levels={state.triggerLevels.fatigue}
							label={T.character.fatigue}
						/>
					</div>
				</div>
			)}
			<PropertyGrid>
				<PropertyGridRow label={T.goods}>
					<GoodsList goods={state.goods} game={character.game} />
				</PropertyGridRow>
				{state.actions && (
					<>
						<PropertyGridRow label={T.character.currentActivity}>
							<div class="character-activity">
								<span
									class={`badge badge-${activityBadgeColors[state.stepType ?? 'idle'] ?? 'gray'}`}
								>
									{state.stepDescription ? T.step[state.stepDescription] : T.step.idle}
								</span>
								{stepEvolution > 0 && (
									<div class="character-activity__progress">
										<div
											class="character-activity__progress-fill"
											style={`width: ${Math.floor(stepEvolution * 100)}%`}
										/>
									</div>
								)}
							</div>
						</PropertyGridRow>
						<PropertyGridRow>
							{state.actions.length > 0 ? (
								<ul class="character-actions">
									{state.actions.map((description) => (
										<li class="character-actions__item">
											<span>{description}</span>
										</li>
									))}
								</ul>
							) : (
								<div class="character-actions__empty">
									{T.character.noActivity}
								</div>
							)}
						</PropertyGridRow>
					</>
				)}
			</PropertyGrid>
		</div>
	)
}

export default CharacterProperties

