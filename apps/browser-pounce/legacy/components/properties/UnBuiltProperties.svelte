<script lang="ts">
import { Badge } from 'flowbite-svelte'
import EntityBadge from '$components/parts/EntityBadge.svelte'
import PropertyGridRow from '$components/parts/PropertyGridRow.svelte'
import type { UnBuiltLand } from '$lib/game/board/content/unbuilt-land'
import { T } from '$lib/i18n'
import { p2s } from '$lib/mutts.svelte'

let { content }: { content: UnBuiltLand } = $props()
const game = content.tile.board.game
const deposit = $derived.by(
	p2s(
		() =>
			content.deposit && {
				sprites: content.deposit.sprites,
				name: content.deposit.name,
				amount: content.deposit.amount,
			},
	),
)
const projectData = $derived.by(
	p2s(() => {
		const proj = content.project
		return proj ? { project: proj, name: proj.replace('build:', '') } : undefined
	}),
)
</script>

{#if !!projectData}
	<PropertyGridRow label={$T.project} class="flex items-center">
		<Badge color="blue">
			{projectData.name ? $T.alveoli[projectData.name] : projectData.project}
		</Badge>
		{#if !content.tile.isClear}
			<Badge color="yellow">{$T.clearing}</Badge>
		{/if}
	</PropertyGridRow>
{/if}

{#if deposit?.amount !== undefined}
	<PropertyGridRow label={$T.deposit} class="flex items-center">
		{#key deposit?.name}
			<EntityBadge
				{game}
				height={16}
				sprite={deposit.sprites[0]}
				text={$T.deposits[deposit.name!]}
				qty={deposit.amount}
			/>
		{/key}
	</PropertyGridRow>
{/if}
