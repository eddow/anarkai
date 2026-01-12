<script lang="ts">
//https://uxwing.com/?s=Mouse+left+
//https://boxy-svg.com/

import { Alert } from 'flowbite-svelte'
import type { Writable } from 'svelte/store'
import DarkMode from '$components/parts/system/dark-mode.svelte'
import { configuration } from '$lib/globals.svelte'
import { T } from '$lib/i18n'

let { title }: { title: Writable<string> } = $props()
$effect(() => {
	title.set($T.ui.configuration)
})
let darkMode = $state(configuration.darkMode)

$effect(() => {
	configuration.darkMode = darkMode
})

$effect(() => {
	localStorage.setItem('configuration', JSON.stringify(configuration))
})
</script>

<DarkMode bind:darkMode />
<Alert>
	<p>{$T.ui.wheelZoomLookAt}</p>
	<p>{$T.ui.bothButtonsPan}</p>
</Alert>
