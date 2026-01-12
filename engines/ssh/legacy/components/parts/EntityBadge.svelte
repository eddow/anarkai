<script lang="ts">
import ResourceImage from '$components/parts/ResourceImage.svelte'
import { type Game } from '$lib/game'

let {
	game,
	sprite,
	text,
	qty,
	height = 20,
} = $props<{
	game: Game
	sprite: string
	text: string
	qty?: number
	height?: number
}>()
</script>

<div
	class="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
>
	<ResourceImage {game} {sprite} {height} alt={text} />
	{#if qty}
		<span class="text-sm font-semibold text-gray-900 dark:text-white">×{qty}</span>
	{/if}
</div>
