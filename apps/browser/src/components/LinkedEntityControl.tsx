import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { mrg } from '@app/lib/globals'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import { Tile } from 'ssh/board/tile'
import type { SyntheticFreightLineObject } from 'ssh/freight/freight-line'
import type { InspectorSelectableObject, InteractiveGameObject } from 'ssh/game/object'
import { resolveSelectableHoverObject } from 'ssh/game/object'
import type { SyntheticHiveObject } from 'ssh/hive'
import { isHoveredObject, setHoveredObject } from 'ssh/interactive-state'
import { computeStyleFromTexture } from 'ssh/utils/images'
import ResourceImage from './ResourceImage'

css`
.linked-entity-control {
	display: inline-flex;
	width: 2.5rem;
	height: 2.5rem;
	align-items: center;
	justify-content: center;
	padding: 0.2rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	border-radius: 0.5rem;
	background-color: color-mix(in srgb, var(--ak-surface-1) 90%, transparent);
	color: inherit;
	cursor: pointer;
	position: relative;
	overflow: hidden;
	flex: none;
}

.linked-entity-control::before {
	content: '';
	position: absolute;
	inset: 0;
	background: inherit;
	opacity: 0.22;
	pointer-events: none;
}

.linked-entity-control:hover {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 44%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 7%, var(--ak-surface-1));
}

.linked-entity-control:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--ak-accent, #8b5cf6) 65%, white);
	outline-offset: 2px;
}

.linked-entity-control__visual,
.linked-entity-control__content {
	position: relative;
	z-index: 1;
}

.linked-entity-control__visual {
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: 0.45rem;
	background-color: color-mix(in srgb, var(--ak-surface-panel) 90%, transparent);
	overflow: hidden;
}

.linked-entity-control__terrain {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	background-color: color-mix(in srgb, var(--ak-surface-panel) 86%, transparent);
}

`

interface LinkedEntityControlProps {
	object:
		| InspectorSelectableObject
		| InteractiveGameObject
		| SyntheticFreightLineObject
		| SyntheticHiveObject
	class?: string
}

const LinkedEntityControl = (props: LinkedEntityControlProps) => {
	const state = reactive({
		backgroundStyle: '',
		sprite: undefined as string | undefined,
		visualObjectUid: '',
		objectTitle: '',
		objectGame: undefined as typeof props.object.game | undefined,
	})
	const visualTile = () => {
		const object = props.object
		if (object instanceof Tile) return object
		return 'tile' in object ? object.tile : undefined
	}

	effect`linked-entity:object-meta`(() => {
		state.visualObjectUid = props.object.uid
		state.objectTitle = props.object.title
		state.objectGame = props.object.game
	})

	effect`linked-entity:visual-object`(() => {
		if (state.visualObjectUid === props.object.uid) return
		state.visualObjectUid = props.object.uid
		state.sprite = undefined
		state.backgroundStyle = ''
	})

	effect`linked-entity:sprite`(() => {
		const object = visualTile()
		if (!(object instanceof Tile)) {
			state.sprite = undefined
			return
		}
		if (!(object.content instanceof Alveolus)) return
		const type = object.content.name as keyof typeof visualAlveoli | undefined
		const nextSprite = type ? visualAlveoli[type]?.sprites?.[0] : undefined
		if (nextSprite) state.sprite = nextSprite
	})

	effect`linked-entity:terrain-style`(() => {
		const object = visualTile()
		if (!(object instanceof Tile)) {
			state.backgroundStyle = ''
			return
		}
		const terrain =
			object.terrainState?.terrain ??
			object.baseTerrain ??
			(object.content instanceof Alveolus ? 'concrete' : 'grass')
		const syncTexture = object.board.game.getTexture(`terrain.${terrain}`)
		if (syncTexture) {
			state.backgroundStyle = computeStyleFromTexture(syncTexture, {
				backgroundRepeat: 'repeat',
			})
			return
		}
		void (async () => {
			await object.board.game.loaded
			const texture = object.board.game.getTexture(`terrain.${terrain}`)
			state.backgroundStyle = texture
				? computeStyleFromTexture(texture, { backgroundRepeat: 'repeat' })
				: ''
		})()
	})

	const applyHover = (event: MouseEvent) => {
		event.stopPropagation()
		const hoverObject = resolveSelectableHoverObject(props.object)
		if (!hoverObject) return
		setHoveredObject(hoverObject)
	}

	const clearHover = (event: MouseEvent) => {
		event.stopPropagation()
		const hoverObject = resolveSelectableHoverObject(props.object)
		if (!hoverObject) return
		if (isHoveredObject(hoverObject)) {
			mrg.hoveredObject = undefined
		}
	}

	const handleClick = (event: MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		showProps(props.object)
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
			class={['linked-entity-control', props.class]}
			style={state.backgroundStyle}
			data-testid="linked-entity-control"
			data-target-uid={state.visualObjectUid}
			onClick={handleClick}
		>
			<span class="linked-entity-control__visual">
				{state.sprite ? (
					<ResourceImage
						game={state.objectGame}
						sprite={state.sprite}
						height={24}
						alt={state.objectTitle}
					/>
				) : (
					<span class="linked-entity-control__terrain" />
				)}
			</span>
		</button>
	)
}

export default LinkedEntityControl
