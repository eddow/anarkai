<script lang="ts">
import Icon from '@iconify/svelte'
import { Button, button } from 'flowbite-svelte'
import type { VariantProps } from 'tailwind-variants'

type ButtonColor = VariantProps<typeof button>['color']

interface ConfirmationOptions {
	text: string
	confirmText?: string
	cancelText?: string
	confirmColor?: ButtonColor
	cancelColor?: ButtonColor
}

let {
	label,
	class: className = '',
	children,
}: { label?: string; class?: string; children: any } = $props()

let isConfirming = $state(false)
let confirmationText = $state('')
let confirmText = $state('Confirm')
let cancelText = $state('Cancel')
let confirmColor = $state<ButtonColor>('red')
let cancelColor = $state<ButtonColor>('gray')
let confirmationResolve: ((value: boolean) => void) | null = null

function confirm(options: ConfirmationOptions): Promise<boolean> {
	return new Promise((resolve) => {
		confirmationText = options.text
		confirmText = options.confirmText || 'Confirm'
		cancelText = options.cancelText || 'Cancel'
		confirmColor = options.confirmColor || 'red'
		cancelColor = options.cancelColor || 'gray'
		isConfirming = true
		confirmationResolve = resolve
	})
}

function handleConfirm() {
	isConfirming = false
	confirmationResolve?.(true)
	confirmationResolve = null
}

function handleCancel() {
	isConfirming = false
	confirmationResolve?.(false)
	confirmationResolve = null
}

// Expose the confirm method to parent components
export { confirm }
</script>

<tr class="property-grid-row">
	{#if isConfirming}
		<th class="property-label">
			<Button size="xs" color={confirmColor} class="font-medium" onclick={handleConfirm}>
				<Icon icon="mdi:check" class="w-3 h-3 mr-1" />
				{confirmText}
			</Button>
		</th>
	{:else if label}
		<th class="property-label">
			<span class="font-medium text-gray-700 dark:text-gray-300">{label}</span>
		</th>
	{/if}
	<td class="property-value {className}" colspan={label || isConfirming ? 1 : 2}>
		{#if isConfirming}
			<div class="flex items-center gap-2">
				<span class="text-sm text-gray-600 dark:text-gray-400">{confirmationText}</span>
				<Button size="xs" color={cancelColor} class="ml-auto" onclick={handleCancel}>
					<Icon icon="mdi:close" class="w-3 h-3 mr-1" />
					{cancelText}
				</Button>
			</div>
		{:else}
			{@render children()}
		{/if}
	</td>
</tr>

<style>
	.property-grid-row {
		border-bottom: 1px solid rgb(229 231 235); /* gray-200 */
	}

	:global(.dark) .property-grid-row {
		border-bottom-color: rgb(55 65 81); /* gray-700 */
	}

	.property-label {
		padding: 0.5rem 0.75rem;
		vertical-align: top;
		width: 40%;
		min-width: 120px;
	}

	.property-value {
		padding: 0.5rem 0.75rem;
		vertical-align: top;
		width: 60%;
	}

	/* Remove border from last row */
	.property-grid-row:last-child {
		border-bottom: none;
	}
</style>
