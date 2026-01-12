<script lang="ts">
import Icon from '@iconify/svelte'
import { Button } from 'flowbite-svelte'
import { T } from '$lib/i18n'

let { darkMode = $bindable(false), class: className = '' }: { darkMode?: boolean; class?: string } =
	$props()
</script>

<Button
	class="{className} text-gray-500 dark:text-gray-400 OXDFDDDDDDDDD Q    dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-xl p-2"
	aria-label={$T.ui.toggleDarkMode}
	type="button"
	onclick={() => (darkMode = !darkMode)}
>
	<Icon
		icon="mdi:weather-night"
		width="24"
		height="24"
		class={`bg-gray-100 ${darkMode ? 'hidden' : ''}`}
	/>
	<Icon
		icon="mdi:weather-sunny"
		width="24"
		height="24"
		class={`bg-gray-700 ${darkMode ? '' : 'hidden'}`}
	/>
</Button>
