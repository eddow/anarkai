<script lang="ts">
import { type Game } from '$lib/game'
import { computeStyleFromTexture } from '$lib/utils/images'

const props = $props<{
	game: Game
	sprite: Ssh.Sprite
	width?: number
	height?: number
	alt?: string
	className?: string
}>()
let { game, sprite, width, height, alt = '', className = '' } = props

let inlineStyle = $state('')

$effect(() => {
	if (!game || !sprite) {
		inlineStyle = ''
		return
	}
	;(async () => {
		await game.loaded
		const texture = game.getTexture(sprite)

		// Calculate dimensions if only one is provided
		const frame = texture?.frame ?? { width: texture?.width ?? 0, height: texture?.height ?? 0 }
		const realWidth = frame?.width ?? texture?.width ?? 0
		const realHeight = frame?.height ?? texture?.height ?? 0

		let targetWidth = width
		let targetHeight = height

		if (targetHeight !== undefined && targetWidth === undefined) {
			targetWidth = (targetHeight * realWidth) / realHeight
		} else if (targetWidth !== undefined && targetHeight === undefined) {
			targetHeight = (targetWidth * realHeight) / realWidth
		}

		const backgroundStyle = computeStyleFromTexture(texture, {
			width: targetWidth,
			height: targetHeight,
		})
		const dimensionsStyle =
			targetWidth && targetHeight ? `width: ${targetWidth}px; height: ${targetHeight}px;` : ''

		inlineStyle = dimensionsStyle + backgroundStyle
	})()
})
</script>

<div
	class={`ssh-resource-image ${className}`}
	style={inlineStyle}
	title={alt}
	aria-label={alt}
></div>

<style>
	.ssh-resource-image {
		display: inline-block;
	}
</style>
