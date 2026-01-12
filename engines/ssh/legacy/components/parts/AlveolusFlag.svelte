<script lang="ts">
import Icon from '@iconify/svelte'
import { Button } from 'flowbite-svelte'

let {
	checked = $bindable(),
	icon,
	name,
	tooltip,
}: {
	checked: boolean
	icon: string
	name: string
	tooltip: string
} = $props()
function toggle() {
	checked = !checked
}
</script>

<Button
	type="button"
	class="flex items-center gap-2 px-1 py-0.5 rounded-lg border transition-all duration-200 {checked
		? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-300'
		: 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'}"
	onclick={toggle}
	title={tooltip}
>
	<Icon
		{icon}
		class="w-4 h-4 {checked
			? 'text-blue-600 dark:text-blue-400'
			: 'text-gray-500 dark:text-gray-400'}"
	/>
	<span class="text-sm font-medium">{name}</span>
</Button>
