import { effect, reactive } from 'mutts'
import type { Game } from '@ssh/lib/game'
import { computeStyleFromTexture } from '@ssh/lib/utils/images'

type ResourceImageProps = {
	game: Game
	sprite: Ssh.Sprite | undefined
	width?: number
	height?: number
	alt?: string
	className?: string
}

const ResourceImage = (props: ResourceImageProps) => {
	const state = reactive({ style: '' })

	effect(() => {
		const { game, sprite } = props
		if (!game || !sprite) {
			state.style = ''
			return
		}

		void (async () => {
			await game.rendererReady
			const texture = game.getTexture(sprite)
			let targetWidth = props.width
			let targetHeight = props.height
			const frame = texture?.frame ?? { width: texture?.width ?? 0, height: texture?.height ?? 0 }
			const realWidth = frame?.width ?? texture?.width ?? 0
			const realHeight = frame?.height ?? texture?.height ?? 0

			if (targetHeight !== undefined && targetWidth === undefined) {
				targetWidth = (targetHeight * realWidth) / Math.max(realHeight, 1)
			} else if (targetWidth !== undefined && targetHeight === undefined) {
				targetHeight = (targetWidth * realHeight) / Math.max(realWidth, 1)
			}

			const backgroundStyle = computeStyleFromTexture(texture, {
				width: targetWidth,
				height: targetHeight,
			})
			const dimensions =
				targetWidth !== undefined && targetHeight !== undefined
					? `width: ${targetWidth}px; height: ${targetHeight}px;`
					: ''
			state.style = `${dimensions}${backgroundStyle}`
		})()
	})

	return (
		<div
			class={['ssh-resource-image', props.className]}
			style={state.style}
			title={props.alt}
			aria-label={props.alt}
		/>
	)
}

export default ResourceImage
