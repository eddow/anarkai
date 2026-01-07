<script lang="ts">
let {
	value,
	levels,
	label,
	showValue = true,
}: {
	value: number
	levels: {
		critical: number
		high: number
		satisfied: number
	}
	label: string
	showValue?: boolean
} = $props()

// Calculate percentage for progress bar
const percentage = $derived(Math.min(100, Math.max(0, Math.floor((100 * value) / levels.critical))))
// Calculate color based on percentage (green to red)
const colorClass = $derived.by(() => {
	if (value < levels.satisfied) return 'bg-green-500'
	if (value < levels.high) return 'bg-yellow-500'
	if (value < levels.critical) return 'bg-orange-500'
	return 'bg-red-500'
})
</script>

<div class="stat-progress-bar">
	<div class="flex items-center justify-between mb-1">
		<span class="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
		{#if showValue}
			<span class="text-sm text-gray-500 dark:text-gray-400">{percentage}%</span>
		{/if}
	</div>
	<div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
		<div
			class="h-2 rounded-full transition-all duration-300 {colorClass}"
			style="width: {percentage}%"
		></div>
	</div>
</div>

<style>
	.stat-progress-bar {
		min-width: 0; /* Allow flex shrinking */
	}
</style>
