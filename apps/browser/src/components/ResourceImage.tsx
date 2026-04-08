import { effect, reactive } from 'mutts'
import type { Game } from 'ssh/game'
import { computeStyleFromTexture } from 'ssh/utils/images'

type ResourceImageProps = {
	game: Game | undefined
	sprite: Ssh.Sprite | undefined
	width?: number
	height?: number
	alt?: string
	className?: string
}

const ResourceImage = (props: ResourceImageProps) => {
	const state = reactive({
		style: '',
		resolvedSprite: undefined as Ssh.Sprite | undefined,
	})

	effect`resource-image:style`(() => {
		const { game, sprite } = props // Access props (reactive)
		if (!game || !sprite) {
			state.style = ''
			state.resolvedSprite = undefined
			return
		}

		const requestSprite = sprite
		const applyResolvedTexture = (texture: any) => {
			if (!texture) return false

			let targetWidth = props.width
			let targetHeight = props.height
			const frame = texture.frame ?? {
				width: texture.width ?? 0,
				height: texture.height ?? 0,
			}
			const realWidth = frame?.width ?? texture.width ?? 0
			const realHeight = frame?.height ?? texture.height ?? 0

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
			state.resolvedSprite = requestSprite
			return true
		}

		const syncTexture = game.getTexture(requestSprite)
		if (applyResolvedTexture(syncTexture)) return

		void (async () => {
			await game.rendererReady
			if (props.game !== game || props.sprite !== requestSprite) return
			const texture = game.getTexture(requestSprite)
			applyResolvedTexture(texture)
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
