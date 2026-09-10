import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { mrg } from '@app/lib/globals'
import { isHoveredObject, setHoveredObject } from '@app/lib/interactive-state'
import { createSyntheticProjectObject } from '@app/lib/project-inspector'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { tablerOutlineClipboardList } from 'pure-glyf/icons'
import type { Tile } from 'ssh/board/tile'
import type { InteractiveGameObject } from 'ssh/game/object'
import type { Project } from 'ssh/project'

css`
.project-anchor-button {
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

.project-anchor-button:hover {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 44%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 7%, var(--ak-surface-1));
}

.project-anchor-button:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--ak-accent, #8b5cf6) 65%, white);
	outline-offset: 2px;
}

.project-anchor-button :global(.ak-icon) {
	display: inline-flex;
	color: inherit;
}
`

interface ProjectAnchorButtonProps {
	/** Owning committed project; stable reference avoids rebuild-fence on synthetic object churn. */
	project?: Project
	tile?: Tile
	title?: string
	class?: string
}

const ProjectAnchorButton = (props: ProjectAnchorButtonProps) => {
	const currentProject = () => props.project
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
		const project = currentProject()
		const game = currentGame()
		if (!project || !game) return
		showProps(createSyntheticProjectObject(game, project))
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

	const label = () => (props.title?.trim() ? props.title! : 'Project')

	return (
		<button
			type="button"
			use={attachHoverTracking}
			class={['project-anchor-button', props.class]}
			data-testid="project-anchor-button"
			title={label()}
			aria-label={label()}
			onClick={handleClick}
		>
			{renderAnarkaiIcon(tablerOutlineClipboardList, {
				size: 20,
				label: label(),
			})}
		</button>
	)
}

export default ProjectAnchorButton
