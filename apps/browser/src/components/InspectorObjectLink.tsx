import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import type { SyntheticHiveObject } from '@app/lib/hive-inspector'
import type { SyntheticFreightLineObject } from 'ssh/freight/freight-line'
import type { InspectorSelectableObject, InteractiveGameObject } from 'ssh/game/object'

css`
.inspector-object-link {
	padding: 0;
	border: none;
	background: none;
	color: var(--ak-accent, #8b5cf6);
	font: inherit;
	cursor: pointer;
	text-align: left;
	text-decoration: underline;
	text-underline-offset: 0.15em;
}

.inspector-object-link:hover {
	color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 80%, white);
}

.inspector-object-link:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--ak-accent, #8b5cf6) 55%, white);
	outline-offset: 2px;
	border-radius: 0.25rem;
}
`

interface InspectorObjectLinkProps {
	object:
		| InspectorSelectableObject
		| InteractiveGameObject
		| SyntheticFreightLineObject
		| SyntheticHiveObject
		| undefined
	label?: string
	class?: string
}

const InspectorObjectLink = (props: InspectorObjectLinkProps) => {
	const view = {
		get class() {
			return ['inspector-object-link', props.class]
		},
		get disabled() {
			return !props.object
		},
		get text() {
			return props.label ?? props.object?.title ?? '—'
		},
	}

	return (
		<button
			type="button"
			class={view.class}
			disabled={view.disabled}
			onClick={(event) => {
				event.preventDefault()
				event.stopPropagation()
				const object = props.object
				if (!object) return
				showProps(object)
			}}
		>
			{view.text}
		</button>
	)
}

export default InspectorObjectLink
