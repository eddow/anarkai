<script lang="ts">
import { goods as goodsCatalog } from '$assets/game-content'
import EntityBadge from '$components/parts/EntityBadge.svelte'
import { type Game } from '$lib/game'
import { T } from '$lib/i18n'
import type { GoodType } from '$lib/types/base'

let {
	goods,
	game,
	itemSize = 20,
	className = '',
} = $props<{
	goods: { [k in GoodType]?: number }
	game: Game
	itemSize?: number
	className?: string
}>()
// Compute a stable, filtered list of entries so DOM diffing is correct when switching sources
const entries = $derived(
	(Object.entries(goods || {}) as [GoodType, number][])
		.filter(([, qty]) => qty && qty > 0)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
)
</script>

{#if entries.length > 0}
	<div class={`goods-list flex flex-wrap gap-2 items-center ${className}`}>
		{#each entries as [good, qty] (good)}
			<EntityBadge
				{game}
				sprite={goodsCatalog[good].sprites[0]}
				text={$T.goods?.[good]}
				{qty}
				height={itemSize}
			/>
		{/each}
	</div>
{/if}

<style>
	.goods-list {
		min-width: 0;
	}
</style>
