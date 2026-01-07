<script lang="ts">
import type { Locale } from 'omni18n/ts/s-a'
import { locale, setLocale } from '$lib/i18n'

const languageOptions = [
	{ value: 'en', flag: '🇺🇸', label: 'English' },
	{ value: 'fr', flag: '🇫🇷', label: 'Français' },
] as const

let showMenu = $state(false)

function handleLanguageChange(newLocale: Locale) {
	setLocale(newLocale)
	showMenu = false
}

function toggleMenu() {
	showMenu = !showMenu
}

// Close menu when clicking outside
function handleClickOutside(event: MouseEvent) {
	const target = event.target as HTMLElement
	if (!target.closest('.language-selector')) {
		showMenu = false
	}
}
</script>

<svelte:window on:click={handleClickOutside} />

<div class="language-selector relative">
	<button
		class="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-xl p-2"
		aria-label="Select language"
		type="button"
		onclick={toggleMenu}
	>
		<span class="text-2xl">{languageOptions.find((opt) => opt.value === $locale)?.flag}</span>
	</button>

	{#if showMenu}
		<div
			class="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-32"
		>
			{#each languageOptions as option}
				<button
					class="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
					onclick={() => handleLanguageChange(option.value as Locale)}
				>
					<span class="text-xl">{option.flag}</span>
					<span>{option.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
