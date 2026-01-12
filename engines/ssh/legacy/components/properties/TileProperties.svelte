<script lang="ts">
import { Badge } from 'flowbite-svelte'
import { alveoli } from '$assets/game-content'
import EntityBadge from '$components/parts/EntityBadge.svelte'
import GoodsList from '$components/parts/GoodsList.svelte'
import PropertyGrid from '$components/parts/PropertyGrid.svelte'
import PropertyGridRow from '$components/parts/PropertyGridRow.svelte'
import AlveolusProperties from '$components/properties/AlveolusProperties.svelte'
import UnBuiltProperties from '$components/properties/UnBuiltProperties.svelte'
import { Alveolus } from '$lib/game/board/content/alveolus'
import { UnBuiltLand } from '$lib/game/board/content/unbuilt-land'
import type { Tile } from '$lib/game/board/tile'
import { T } from '$lib/i18n'
import { m2s, p2s } from '$lib/mutts.svelte'
import { computeStyleFromTexture } from '$lib/utils/images'

let { tile }: { tile: Tile } = $props()
//*
let tileContent = $derived.by(p2s(() => tile.content))
let stock = $derived.by(p2s(() => tile.content!.storage?.stock)) /*/
	let tileContent = $derived(m2s(tile.content))
	let stock = $derived(m2s(tile.content!.storage?.stock))//*/
// Aggregate unallocated free goods on the ground into a GoodType -> count map
let freeStock = $derived.by(
	p2s(() => {
		const counts: Record<string, number> = {}
		for (const fg of tile.freeGoods) {
			if (!fg.available) continue
			counts[fg.goodType] = (counts[fg.goodType] || 0) + 1
		}
		return counts as any
	}),
)

// Get alveolus type info for display
let contentInfo = $derived.by(
	p2s(() => {
		if (tileContent instanceof Alveolus) {
			const type = tileContent.name as keyof typeof alveoli
			return {
				type,
				sprite: alveoli[type]?.sprites?.[0],
				name: $T.alveoli[type],
				terrain: 'concrete',
			}
		}
		return {
			terrain: tileContent instanceof UnBuiltLand ? tileContent.terrain : 'concrete',
		}
	}),
)
// Get terrain background using game texture system
let terrainBackgroundStyle = $state('')

$effect(() => {
	if (contentInfo?.terrain) {
		;(async () => {
			await tile.board.game.loaded
			const texture = tile.board.game.getTexture(`terrain.${contentInfo.terrain}`)
			terrainBackgroundStyle = computeStyleFromTexture(texture, {
				backgroundRepeat: 'repeat',
			})
		})()
	} else {
		terrainBackgroundStyle = ''
	}
})
</script>

{#if tileContent}
	<div
		class="tile-properties"
		class:has-terrain={terrainBackgroundStyle}
		style={terrainBackgroundStyle}
	>
		<!-- Main title/icon for alveolus type -->
		{#if contentInfo?.type}
			<div class="flex items-center gap-3 mb-4">
				{#key contentInfo.type}
					<EntityBadge
						game={tile.board.game}
						sprite={contentInfo.sprite}
						text={contentInfo.name}
						height={32}
					/>
				{/key}
			</div>
		{/if}

		<div class="space-y-2">
			<PropertyGrid>
				<!-- Walk time as first property -->
				<PropertyGridRow label={$T.tile.walkTime}>
					<Badge color={tileContent.walkTime === Number.POSITIVE_INFINITY ? 'red' : 'yellow'}>
						{tileContent.walkTime === Number.POSITIVE_INFINITY
							? $T.tile.unwalkable
							: tileContent.walkTime}
					</Badge>
				</PropertyGridRow>

				{#if stock}
					<PropertyGridRow label={$T.goods.stored}>
						<GoodsList goods={stock} game={tile.board.game} />
					</PropertyGridRow>
				{/if}

				{#if Object.keys(freeStock).length > 0}
					<PropertyGridRow label={$T.goods.loose}>
						<GoodsList goods={freeStock as any} game={tile.board.game} />
					</PropertyGridRow>
				{/if}

				{#if tileContent instanceof UnBuiltLand}
					<UnBuiltProperties content={tileContent} />
				{:else if tileContent instanceof Alveolus}
					<AlveolusProperties content={tileContent} />
				{/if}
			</PropertyGrid>
		</div>
	</div>
{/if}

<style>
	.tile-properties {
		padding: 1rem;
		position: relative;
	}

	.has-terrain {
		position: relative;
	}
</style>
