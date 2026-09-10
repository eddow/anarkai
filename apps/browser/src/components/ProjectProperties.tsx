import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
import { projectPreviewState } from '@app/lib/interactive-state'
import { projectInspectorTitle, type SyntheticProjectObject } from '@app/lib/project-inspector'
import { InspectorSection } from '@app/ui/anarkai'
import { effect, reactive } from 'mutts'
import ConstructionProgressBar from './ConstructionProgressBar'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'

css`
.project-properties__open {
	padding: 0.35rem 0.55rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-accent, #8b5cf6) 35%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 10%, var(--ak-surface-panel));
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.8rem;
}
`

interface ProjectPropertiesProps {
	projectObject: SyntheticProjectObject
}

const ProjectProperties = (props: ProjectPropertiesProps) => {
	const state = reactive({
		completed: 0,
		total: 0,
		workLine: '',
	})

	const project = () => props.projectObject.project
	const game = () => props.projectObject.game

	effect`project-properties:progress`(() => {
		const p = project()
		const g = game()
		if (!p || !g) {
			state.completed = 0
			state.total = 0
			state.workLine = ''
			return
		}
		try {
			const progress = g.projectProgress(p)
			state.completed = progress.completed
			state.total = progress.total
			state.workLine = `${Math.floor(progress.completed)}/${progress.total}`
		} catch {
			state.completed = 0
			state.total = 0
			state.workLine = ''
		}
	})

	const openInManager = () => {
		projectPreviewState.project = project()
		projectPreviewState.active = true
		void import('@app/palette/browser-palette').then(({ palettePanelBridge }) => {
			palettePanelBridge.openProjects()
		})
	}

	return (
		<InspectorSection title={projectInspectorTitle(project())}>
			<PropertyGrid>
				<PropertyGridRow label={String((T as any).project?.stage ?? 'Stage')}>
					<span>{project()?.stage}</span>
				</PropertyGridRow>
				<PropertyGridRow label={String((T as any).project?.progress ?? 'Progress')}>
					<ConstructionProgressBar
						applied={state.completed}
						total={state.total}
						label={state.workLine}
						testId="project-progress"
					/>
				</PropertyGridRow>
				<PropertyGridRow label="">
					<button
						type="button"
						class="project-properties__open"
						data-testid="project-open-in-manager"
						onClick={openInManager}
					>
						{String((T as any).project?.openInManager ?? 'Open in projects')}
					</button>
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default ProjectProperties
