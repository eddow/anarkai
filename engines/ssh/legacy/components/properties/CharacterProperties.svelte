<script lang="ts">
import { Badge, badge } from 'flowbite-svelte'
import type { VariantProps } from 'tailwind-variants'
import GoodsList from '$components/parts/GoodsList.svelte'
import PropertyGrid from '$components/parts/PropertyGrid.svelte'
import PropertyGridRow from '$components/parts/PropertyGridRow.svelte'
import StatProgressBar from '$components/parts/StatProgressBar.svelte'
import { AEvolutionStep, ALerpStep } from '$lib/game/npcs/steps'
import type { Character } from '$lib/game/population/character'
import { T } from '$lib/i18n'
import { p2s } from '$lib/mutts.svelte'

let { character }: { character: Character } = $props()
const actions = $derived.by(p2s(() => character.actionDescription))
const state = $derived.by(
	p2s(() => ({
		hunger: character.hunger,
		Tiredness: character.tiredness,
		fatigue: character.fatigue,
		triggerLevels: character.triggerLevels,
		stepType: character.stepExecutor?.type as Ssh.ActivityType | undefined,
		stepDescription: (character.stepExecutor?.description || undefined) as string | undefined,
		step: character.stepExecutor instanceof AEvolutionStep ? character.stepExecutor : undefined,
		goods: character.carry.stock,
	})),
)

const stepEvolution = $derived(
	state?.step && !(state.step instanceof ALerpStep)
		? Math.max(0, Math.min(1, state.step.evolution))
		: 0,
)

type BadgeColor = VariantProps<typeof badge>['color']

const activityBadgeColors: Record<Ssh.ActivityType, BadgeColor> = {
	walk: 'yellow',
	work: 'red',
	eat: 'green',
	sleep: 'purple',
	rest: 'indigo',
	convey: 'blue',
	idle: 'gray',
	gather: 'pink',
}
</script>

<div class="character-properties">
	{#if state}
		{#if state.triggerLevels}
			<div class="mt-4">
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
					<StatProgressBar
						value={state.hunger}
						levels={state.triggerLevels.hunger}
						label={$T.character.hunger}
					/>
					<StatProgressBar
						value={state.Tiredness}
						levels={state.triggerLevels.tiredness}
						label={$T.character.tiredness}
					/>
					<StatProgressBar
						value={state.fatigue}
						levels={state.triggerLevels.fatigue}
						label={$T.character.fatigue}
					/>
				</div>
			</div>
		{/if}
		<PropertyGrid>
			<PropertyGridRow label={$T.goods}>
				<GoodsList goods={state.goods} game={character.game} />
			</PropertyGridRow>
			{#if actions}
				<PropertyGridRow label={$T.character.currentActivity}>
					<div class="flex items-center gap-2">
						<Badge color={activityBadgeColors[state.stepType ?? 'idle']}>
							{#if state.stepDescription}
								{$T.step[state.stepDescription]}
							{:else}
								{$T.step.idle}
							{/if}
						</Badge>
						{#if stepEvolution > 0}
							<div class="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
								<div
									class="h-2 bg-gray-400 dark:bg-gray-500"
									style={`width: ${Math.floor(stepEvolution * 100)}%`}
								></div>
							</div>
						{/if}
					</div>
				</PropertyGridRow>

				<PropertyGridRow>
					{#if actions.length > 0}
						<ul
							class="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 space-y-1"
						>
							{#each actions as description}
								<li class="flex items-center gap-2">
									<span>{description}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<div
							class="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 italic"
						>
							{$T.character.noActivity}
						</div>
					{/if}
				</PropertyGridRow>
			{/if}
		</PropertyGrid>
	{/if}
</div>

<style>
	.character-properties {
		padding: 1rem;
	}
</style>
