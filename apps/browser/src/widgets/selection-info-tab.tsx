import { css } from '@app/lib/css'
import type { DockviewWidget, DockviewWidgetScope } from '@sursaut/ui/dockview'

export type SelectionInfoTool = {
	ariaLabel: string
	icon: string
	onClick: () => void
}

export type SelectionInfoContext = {
	tools?: readonly SelectionInfoTool[]
}

css`
.selection-info-tab {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	width: 100%;
	min-width: 0;
}

.selection-info-tab__title {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.selection-info-tab__tools {
	display: flex;
	align-items: center;
	gap: 0.2rem;
	flex: 0 0 auto;
}

.selection-info-tab__button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.5rem;
	height: 1.5rem;
	padding: 0;
	border: none;
	border-radius: 0.35rem;
	background: transparent;
	color: inherit;
	cursor: pointer;
	opacity: 0.8;
}

.selection-info-tab__button:hover {
	opacity: 1;
	background: color-mix(in srgb, currentColor 12%, transparent);
}
`

const SelectionInfoTab: DockviewWidget<Record<string, never>, SelectionInfoContext> = (
	props,
	scope: DockviewWidgetScope
) => {
	const tools = () => props.context.tools ?? []
	return (
		<div class="selection-info-tab">
			<span class="selection-info-tab__title title" title={props.title}>
				{props.title}
			</span>
			<div if={tools().length > 0} class="selection-info-tab__tools">
				<for each={tools()}>
					{(tool: SelectionInfoTool) => (
						<button
							class="selection-info-tab__button"
							aria-label={tool.ariaLabel}
							onClick={tool.onClick}
						>
							{tool.icon}
						</button>
					)}
				</for>
			</div>
			<button
				class="selection-info-tab__button close"
				aria-label={`Close ${props.title}`}
				onClick={() => scope.panelApi?.close()}
			>
				×
			</button>
		</div>
	)
}

export default SelectionInfoTab
