<script lang="ts">
let { class: className = '', children }: { class?: string; children: any } = $props()
</script>

<div class="property-grid-container {className}">
	<table class="property-grid">
		<tbody>
			{@render children()}
		</tbody>
	</table>
</div>

<style>
	.property-grid-container {
		background-color: rgb(255 255 255); /* white */
		border: 1px solid rgb(229 231 235); /* gray-200 */
		border-radius: 0.5rem; /* rounded-lg */
		overflow: hidden;
	}

	:global(.dark) .property-grid-container {
		background-color: rgb(31 41 55); /* gray-800 */
		border-color: rgb(55 65 81); /* gray-700 */
	}

	.property-grid {
		width: 100%;
		border-collapse: collapse;
	}

	:global(.property-grid tbody tr:hover) {
		background-color: rgb(249 250 251); /* gray-50 */
	}

	:global(.dark .property-grid tbody tr:hover) {
		background-color: rgb(55 65 81); /* gray-700 */
	}
</style>
