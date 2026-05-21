import { css } from '@app/lib/css'
import { zoneOverlayState } from '@app/lib/freight-line-overlay'
import { mrg } from '@app/lib/globals'
import { isHoveredObject, setHoveredObject } from '@app/lib/interactive-state'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { tablerOutlinePolygon } from 'pure-glyf/icons'
import type { Tile } from 'ssh/board/tile'
import type { InteractiveGameObject } from 'ssh/game/object'

css`
.zone-anchor-button {
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

.zone-anchor-button:hover {
	border-color: color-mix(in srgb, var(--ak-accent, #6d8cff) 44%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #6d8cff) 7%, var(--ak-surface-1));
}

.zone-anchor-button:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--ak-accent, #6d8cff) 65%, white);
	outline-offset: 2px;
}

.zone-anchor-button :global(.ak-icon) {
	display: inline-flex;
	color: inherit;
}
`

interface ZoneAnchorButtonProps {
	tile?: Tile
	title?: string
	class?: string
}

const ZoneAnchorButton = (props: ZoneAnchorButtonProps) => {
	const currentTile = () => props.tile
	const hoverTarget = (): InteractiveGameObject | undefined => currentTile()
	const label = () => props.title?.trim() || 'Zone'

	const applyHover = (event: MouseEvent) => {
		event.stopPropagation()
		const target = hoverTarget()
		if (target) setHoveredObject(target)
		const zoneId = currentTile()?.zone
		if (zoneId) zoneOverlayState.hoveredZoneId = zoneId
	}

	const clearHover = (event: MouseEvent) => {
		event.stopPropagation()
		const target = hoverTarget()
		if (target && isHoveredObject(target)) mrg.hoveredObject = undefined
		const zoneId = currentTile()?.zone
		if (zoneId && zoneOverlayState.hoveredZoneId === zoneId)
			zoneOverlayState.hoveredZoneId = undefined
	}

	const handleClick = (event: MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		const zoneId = currentTile()?.zone
		if (zoneId) {
			void import('@app/lib/zone-selection').then(({ showZoneObject }) => showZoneObject(zoneId))
		}
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

	return (
		<button
			type="button"
			use={attachHoverTracking}
			class={['zone-anchor-button', props.class]}
			data-testid="zone-anchor-button"
			title={label()}
			aria-label={label()}
			onClick={handleClick}
		>
			{renderAnarkaiIcon(tablerOutlinePolygon, { size: 20, label: label() })}
		</button>
	)
}

export default ZoneAnchorButton
