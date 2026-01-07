<script lang="ts">
import {
	Button,
	Table,
	TableBody,
	TableBodyCell,
	TableBodyRow,
	TableHeadCell,
} from 'flowbite-svelte'
import type { Writable } from 'svelte/store'
import { debugInfo, mrg } from '$lib/globals.svelte'
import { T } from '$lib/i18n'
import { p2s } from '$lib/mutts.svelte'

function ownEntries(value: any) {
	return Object.entries(Object.getOwnPropertyDescriptors(value))
		.filter(([_, v]) => v.enumerable)
		.map(([k, v]) => [k, v.value])
}
let { title }: { title: Writable<string> } = $props()
$effect(() => {
	title.set($T.ui.debugInfo)
})
function debugged(value: any, already = new Set<any>()) {
	if (already.has(value)) return '[Circular]'
	already.add(value)
	try {
		if (typeof value === 'number') return value.toFixed(2)
		if (typeof value !== 'object') return value
		if (!value) return `${value}`
		return ownEntries(value)
			.map(([k, v]): string => `${k}: ${debugged(v, already)}`)
			.join(' | ')
	} finally {
		already.delete(value)
	}
}
const dDebugInfo = $derived(Object.entries(debugInfo))
function resetLayout() {
	localStorage.removeItem('layout')
	location.reload()
}
function displayed(content: any) {
	if (typeof content !== 'object') return content
	return ownEntries(content)
		.map(([k, v]) => [k, debugged(v)])
		.join(' | ')
}
let mrgHoveredObject = $derived.by(p2s(() => mrg.hoveredObject))
</script>

<Button class="w-full" onclick={resetLayout}>{$T.ui.resetLayout}</Button>
<h1>{$T.ui.selection} : {mrgHoveredObject?.title ?? $T.ui.none}</h1>
{#if mrgHoveredObject}
	<Table>
		<TableBody title={$T.ui.debugInfo}>
			{#each ownEntries(mrgHoveredObject.debugInfo) as kvp}
				<TableBodyRow>
					<TableHeadCell>{kvp[0]}</TableHeadCell>
					<TableBodyCell>{displayed(kvp[1])}</TableBodyCell>
				</TableBodyRow>
			{/each}
		</TableBody>
	</Table>
{/if}
{#each dDebugInfo as content}
	<h2>{content[0]}</h2>
	<Table>
		{#if typeof content[1] === 'object'}
			<TableBody title={$T.ui.debugInfo}>
				{#each ownEntries(content[1]) as kvp}
					<TableBodyRow>
						<TableHeadCell>{kvp[0]}</TableHeadCell>
						<TableBodyCell>{displayed(kvp[1])}</TableBodyCell>
					</TableBodyRow>
				{/each}
			</TableBody>
		{:else}
			{content[1]}
		{/if}
	</Table>
{/each}
