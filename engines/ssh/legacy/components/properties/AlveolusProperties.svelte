<script lang="ts">
import Icon from '@iconify/svelte'
import { Button } from 'flowbite-svelte'
import AlveolusFlag from '$components/parts/AlveolusFlag.svelte'
import PropertyGridRow from '$components/parts/PropertyGridRow.svelte'
import type { Alveolus } from '$lib/game/board/content/alveolus'
import { T } from '$lib/i18n'
import { m2s } from '$lib/mutts.svelte'

let { content }: { content: Alveolus } = $props()

// Create the reactive proxy
let alveolus: Alveolus = $derived(m2s(content))

// Check if storage is not empty
let isStorageEmpty = $derived(alveolus?.storage?.isEmpty)

// Reference to the PropertyGridRow for confirmation
let commandsRow: PropertyGridRow | undefined = $state(undefined)

async function handleCleanUp() {
	const confirmed = await commandsRow!.confirm({
		text: $T.alveolus.cleanUpConfirmText,
		confirmText: $T.alveolus.clear,
		cancelText: $T.alveolus.keep,
	})

	if (confirmed) {
		// Call the cleanUp method on the alveolus
		content.cleanUp()
		console.log('Clean up completed for alveolus:', content.name)
	}
}
</script>

{#if alveolus}
	<PropertyGridRow bind:this={commandsRow} label={$T.alveolus.commands}>
		<div class="flex gap-2">
			<AlveolusFlag
				bind:checked={alveolus.working}
				icon="mdi:cog"
				name={$T.alveolus.working}
				tooltip={$T.alveolus.workingTooltip}
			/>
			{#if !isStorageEmpty}
				<Button color="red" size="sm" onclick={handleCleanUp} title={$T.alveolus.cleanUpTooltip}>
					<Icon icon="mdi:broom" class="w-4 h-4" />
					<span class="ml-1">{$T.alveolus.cleanUp}</span>
				</Button>
			{/if}
		</div>
	</PropertyGridRow>
{/if}
