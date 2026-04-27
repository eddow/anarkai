import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { mrg } from '@app/lib/globals'
import { createSyntheticHiveObject } from '@app/lib/hive-inspector'
import { isHoveredObject, setHoveredObject } from '@app/lib/interactive-state'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { tablerOutlineHexagons } from 'pure-glyf/icons'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import type { InteractiveGameObject } from 'ssh/game/object'

css`
.hive-anchor-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	padding: 0.2rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	border-radius: 0.5rem;
	background-color: color-mix(in srgb, var(--ak-surface-1) 90%, transparent);
	color: inherit;
	cursor: pointer;
	flex: none;
}

.hive-anchor-button:hover {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 44%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 7%, var(--ak-surface-1));
}

.hive-anchor-button:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--ak-accent, #8b5cf6) 65%, white);
	outline-offset: 2px;
}

.hive-anchor-button :global(.ak-icon) {
	display: inline-flex;
	color: inherit;
}
`

interface HiveAnchorButtonProps {
	/** Anchor tile hosting the alveolus; stable reference avoids rebuild-fence on synthetic object churn. */
	tile?: Tile
	title?: string
	class?: string
}

const HiveAnchorButton = (props: HiveAnchorButtonProps) => {
	const currentTile = () => props.tile
	const currentGame = () => currentTile()?.board?.game
	const hoverTarget = (): InteractiveGameObject | undefined => currentTile()

	const applyHover = (event: MouseEvent) => {
		event.stopPropagation()
		const target = hoverTarget()
		if (target) setHoveredObject(target)
	}

	const clearHover = (event: MouseEvent) => {
		event.stopPropagation()
		const target = hoverTarget()
		if (target && isHoveredObject(target)) {
			mrg.hoveredObject = undefined
		}
	}

	const handleClick = (event: MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		const tile = currentTile()
		const game = currentGame()
		if (!tile || !game) return
		const content = tile.content
		if (!(content instanceof Alveolus)) return
		const synthetic = createSyntheticHiveObject(game, tile)
		if (synthetic) showProps(synthetic)
	}

	const attachHoverTracking = (element: HTMLElement) => {
		const handleEnter = (event: MouseEvent) => applyHover(event)
		const handleMove = (event: MouseEvent) => applyHover(event)
		const handleLeave = (event: MouseEvent) => clearHover(event)

		element.addEventListener('mouseenter', handleEnter)
		element.addEventListener('mousemove', handleMove)
		element.addEventListener('mouseleave', handleLeave)

		return () => {
			element.removeEventListener('mouseenter', handleEnter)
			element.removeEventListener('mousemove', handleMove)
			element.removeEventListener('mouseleave', handleLeave)
		}
	}

	const label = () => (props.title?.trim() ? props.title! : 'Hive')

	return (
		<button
			type="button"
			use={attachHoverTracking}
			class={['hive-anchor-button', props.class]}
			data-testid="hive-anchor-button"
			title={label()}
			aria-label={label()}
			onClick={handleClick}
		>
			{renderAnarkaiIcon(tablerOutlineHexagons, {
				size: 20,
				label: label(),
			})}
		</button>
	)
}

export default HiveAnchorButton
