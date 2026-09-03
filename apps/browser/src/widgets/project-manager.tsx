import ConstructionProgressBar from '@app/components/ConstructionProgressBar'
import {
	getAppShellBuildToolbarRoots,
	getAppShellVariantEntries,
} from '@app/lib/app-shell-controls'
import { css } from '@app/lib/css'
import { game, interactionMode, projectEditingState, projectPreviewState } from '@app/lib/globals'
import { Button, InspectorSection } from '@app/ui/anarkai'
import { effect, reactive } from 'mutts'
import { ROAD_TYPES } from 'ssh/board/roads'
import type { ProjectSourcingMode } from 'ssh/commerce/commerce-model'
import type { HivePlan } from 'ssh/hive-plan'
import {
	groupRoadsByConnectedType,
	type Project,
	type ProjectStage,
	projectSourcingMode,
} from 'ssh/project'
import type { GoodType } from 'ssh/types/base'

css`
.project-manager {
	display: grid;
	grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
	gap: 0.75rem;
	height: 100%;
	padding: 0.75rem;
	box-sizing: border-box;
	color: var(--ak-text);
}

.project-manager__sidebar,
.project-manager__detail {
	min-width: 0;
	overflow: auto;
}

.project-manager__filters,
.project-manager__actions,
.project-manager__tools {
	display: flex;
	gap: 0.35rem;
	flex-wrap: wrap;
}

.project-manager__filters {
	margin-block: 0.65rem;
}

.project-manager__list {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.project-manager__project {
	text-align: left;
	padding: 0.45rem 0.55rem;
	border: 1px solid var(--ak-border);
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	border-radius: 0.35rem;
	cursor: pointer;
}

.project-manager__project-head {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.project-manager__project-head input[type="radio"] {
	width: auto;
}

.project-manager__project[data-selected="true"],
.project-manager__filter[data-selected="true"] {
	border-color: color-mix(in srgb, var(--ak-accent, #2563eb) 70%, var(--ak-border));
	background: color-mix(in srgb, var(--ak-accent, #2563eb) 12%, var(--ak-surface-panel));
}

.project-manager__filter {
	border: 1px solid var(--ak-border);
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	border-radius: 999px;
	padding: 0.3rem 0.6rem;
	cursor: pointer;
}

.project-manager__muted,
.project-manager__issue {
	color: var(--ak-text-muted);
	font-size: 0.82rem;
}

.project-manager__issue {
	color: #b45309;
}

.project-manager__field {
	display: grid;
	gap: 0.35rem;
	margin-block: 0.5rem;
}

.project-manager input {
	box-sizing: border-box;
	width: 100%;
	padding: 0.35rem 0.45rem;
	border: 1px solid var(--ak-border);
	border-radius: 0.35rem;
	background: var(--ak-surface-panel);
	color: var(--ak-text);
}

.project-manager__stage {
	text-transform: capitalize;
	font-size: 0.76rem;
	color: var(--ak-text-muted);
}

.project-manager__tree {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	font-size: 0.85rem;
}

.project-manager__tree-row {
	padding: 0.12rem 0.35rem;
	border-radius: 0.25rem;
}

.project-manager__tree-row--group {
	font-weight: 650;
	color: var(--ak-text-muted);
	margin-top: 0.35rem;
}

.project-manager__tree-row--child {
	padding-left: 1.4rem;
	color: var(--ak-text);
}

.project-manager__bill {
	display: grid;
	gap: 0.2rem;
	font-size: 0.85rem;
}

.project-manager__bill-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

.project-manager__sourcing {
	display: inline-flex;
	gap: 0.2rem;
}

.project-manager__sourcing button {
	border: 1px solid var(--ak-border);
	background: var(--ak-surface-panel);
	color: var(--ak-text-muted);
	border-radius: 999px;
	padding: 0.1rem 0.45rem;
	font-size: 0.72rem;
	cursor: pointer;
}

.project-manager__sourcing button[data-selected='true'] {
	color: var(--ak-text);
	border-color: color-mix(in srgb, var(--ak-accent, #2563eb) 70%, var(--ak-border));
	background: color-mix(in srgb, var(--ak-accent, #2563eb) 14%, var(--ak-surface-panel));
}

.project-manager__progress {
	display: grid;
	gap: 0.4rem;
	font-size: 0.82rem;
}

.project-manager__progress-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 0.5rem;
	padding: 0.15rem 0.35rem;
	border-radius: 0.25rem;
}

.project-manager__progress-state {
	font-size: 0.72rem;
	text-transform: capitalize;
	color: var(--ak-text-muted);
}

.project-manager__tools {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.project-manager__tool-group {
	border: 1px solid var(--ak-border);
	border-radius: 0.35rem;
	background: var(--ak-surface-panel);
}

.project-manager__tool-group-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	width: 100%;
	padding: 0.4rem 0.55rem;
	border: none;
	background: transparent;
	color: var(--ak-text);
	font-weight: 650;
	cursor: pointer;
	text-align: left;
}

.project-manager__tool-group-head .chevron {
	color: var(--ak-text-muted);
	font-size: 0.75rem;
	transition: transform 120ms ease;
}

.project-manager__tool-group[data-collapsed="true"] .chevron {
	transform: rotate(-90deg);
}

.project-manager__tool-group-body {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	padding: 0.45rem 0.55rem;
	border-top: 1px solid var(--ak-border);
}

.project-manager__tool-group[data-collapsed="true"] .project-manager__tool-group-body {
	display: none;
}

.project-manager__hive-controls {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	align-items: center;
	padding: 0.35rem 0.55rem;
	font-size: 0.82rem;
	color: var(--ak-text-muted);
}
`

type StageFilter = 'all' | ProjectStage

const stageLabels: Record<ProjectStage, string> = {
	draft: 'Draft',
	working: 'Working',
	archived: 'Archived',
}

const projectFilters: { value: StageFilter; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'working', label: 'Working' },
	{ value: 'archived', label: 'Archived' },
]

/** Build-tool roots (root alveoli) for the project editor's Alveoli group. */
const buildToolbarRoots = getAppShellBuildToolbarRoots()
/** Build-tool variant leaves (`build:<root>#<variant>`) for the project editor. */
const buildVariantEntries = getAppShellVariantEntries()

const SOURCING_MODES: { value: ProjectSourcingMode; label: string }[] = [
	{ value: 'auto', label: 'auto' },
	{ value: 'take', label: 'take' },
	{ value: 'buy', label: 'buy' },
]

function uniqueProjectName(base: string): string {
	const names = new Set(game.projects.projects.map((project) => project.name))
	if (!names.has(base)) return base
	let index = 2
	while (names.has(`${base} ${index}`)) index++
	return `${base} ${index}`
}

const ProjectManagerWidget = (props: { title?: string }) => {
	props.title = 'Projects'
	const state = reactive({
		filter: 'all' as StageFilter,
		selectedProject: undefined as Project | undefined,
		message: '',
		collapsed: {
			hives: false,
			alveoli: false,
			roads: false,
			bulldoze: false,
		},
	})

	const projectsForFilter = () =>
		state.filter === 'all'
			? game.projects.projects
			: game.projects.projects.filter((project) => project.stage === state.filter)
	const selectedProject = () => state.selectedProject
	const roadGroups = () => {
		const project = selectedProject()
		return project ? groupRoadsByConnectedType(project.roads) : []
	}
	const canCommit = () => {
		const project = selectedProject()
		return !!project && project.stage === 'draft'
	}

	const previewedProject = () =>
		projectPreviewState.active ? projectPreviewState.project : undefined

	const setPreview = (project: Project | undefined) => {
		projectPreviewState.project = project
		projectPreviewState.active = !!project
	}

	effect`project-manager:selected`(() => {
		const selected = selectedProject()
		const list = projectsForFilter()
		if (!selected && list[0]) state.selectedProject = list[0]
		// Preview the selected project by default when the widget opens.
		if (selected && !previewedProject()) setPreview(selected)
	})

	const selectProject = (project: Project) => {
		state.selectedProject = project
		setPreview(project)
	}

	const setFilter = (filter: StageFilter) => {
		state.filter = filter !== 'all' && state.filter === filter ? 'all' : filter
		const list = projectsForFilter()
		const selected = selectedProject()
		if (!selected || !list.some((project) => project === selected)) {
			state.selectedProject = list[0]
		}
	}

	const createNewProject = () => {
		const project = game.projects.createDraft(uniqueProjectName('New project'), [])
		state.filter = 'all'
		state.selectedProject = project
		state.message = 'New draft created.'
	}

	const rename = (v: string) => {
		const project = selectedProject()
		if (!project || project.stage !== 'draft') return
		game.projects.updateDraft(project, { name: v })
	}

	const pickTool = (tool: string) => {
		const project = selectedProject()
		if (!project || project.stage !== 'draft') {
			state.message = 'Select a draft project to edit.'
			return
		}
		projectEditingState.project = project
		projectEditingState.hivePlan = undefined
		projectEditingState.rotation = 0
		projectEditingState.mirror = false
		interactionMode.selectedAction = tool
		state.message = `Tool: ${tool || 'select'}`
	}

	/** `el` props marking a tool button as the currently-selected tool (radio look). */
	const toolEl = (selected: boolean): JSX.IntrinsicElements['button'] => ({
		'aria-pressed': selected ? 'true' : 'false',
		'data-selected': selected ? 'true' : 'false',
	})

	const pickHive = (hivePlan: HivePlan) => {
		const project = selectedProject()
		if (!project || project.stage !== 'draft') {
			state.message = 'Select a draft project to edit.'
			return
		}
		projectEditingState.project = project
		projectEditingState.hivePlan = hivePlan
		projectEditingState.rotation = 0
		projectEditingState.mirror = false
		interactionMode.selectedAction = 'hive'
		state.message = `Stamping "${hivePlan.name}" — click the board to place (R/Q rotate, M mirror).`
	}

	const commitSelected = () => {
		const project = selectedProject()
		if (!project) return
		const result = game.commitProject(project)
		if (!result.ok) {
			state.message = (result.issues[0]?.message ?? 'Project cannot be committed.') as string
			return
		}
		state.message = `${project.name} committed.`
	}

	const archiveSelected = () => {
		const project = selectedProject()
		if (!project) return
		game.projects.archive(project)
		state.message = `${project.name} archived.`
	}

	const unarchiveSelected = () => {
		const project = selectedProject()
		if (!project) return
		game.projects.unarchive(project)
		state.message = `${project.name} restored as draft.`
	}

	const billEntries = () => {
		const project = selectedProject()
		if (!project) return []
		const required = project.validationProgress.requiredGoods
		const delivered = project.validationProgress.deliveredGoods
		return Object.entries(required).map(([good, qty]) => ({
			good,
			required: qty ?? 0,
			delivered: delivered[good as keyof typeof delivered] ?? 0,
		}))
	}

	const sourcingModeFor = (good: string) => projectSourcingMode(selectedProject(), good as GoodType)
	const setSourcing = (good: string, mode: ProjectSourcingMode) => {
		const project = selectedProject()
		if (!project) return
		game.projects.setSourcingMode(project, good as GoodType, mode)
	}

	const progress = () => {
		const project = selectedProject()
		return project && project.stage === 'working' ? game.projectProgress(project) : undefined
	}

	return (
		<div class="project-manager">
			<div class="project-manager__sidebar">
				<Button onClick={createNewProject}>New</Button>
				<div class="project-manager__filters">
					<for each={projectFilters}>
						{(filter) => (
							<button
								type="button"
								class="project-manager__filter"
								data-selected={state.filter === filter.value ? 'true' : 'false'}
								onClick={() => setFilter(filter.value)}
							>
								{filter.label}
							</button>
						)}
					</for>
				</div>
				<div class="project-manager__list">
					<for each={projectsForFilter()}>
						{(project) => (
							<button
								type="button"
								class="project-manager__project"
								data-selected={state.selectedProject === project ? 'true' : 'false'}
								onClick={() => selectProject(project)}
							>
								<div class="project-manager__project-head">
									<input
										type="radio"
										name="project-preview"
										checked={previewedProject() === project}
										onChange={() => setPreview(project)}
										onClick={(e: Event) => e.stopPropagation()}
									/>
									<span>{project.name}</span>
								</div>
								<div class="project-manager__stage">
									{project.entries.length} alveoli · {project.roads.length} roads ·{' '}
									{stageLabels[project.stage as ProjectStage]}
								</div>
							</button>
						)}
					</for>
					<div if={projectsForFilter().length === 0} class="project-manager__muted">
						No projects in this filter.
					</div>
				</div>
			</div>
			<div class="project-manager__detail">
				<div if={!selectedProject()} class="project-manager__muted">
					Create or select a project.
				</div>
				<div if={!!selectedProject()}>
					<InspectorSection title="Project">
						<div class="project-manager__field">
							<label>Name</label>
							<input
								value={selectedProject()?.name ?? ''}
								disabled={selectedProject()?.stage !== 'draft'}
								update:value={rename}
							/>
						</div>
						<div class="project-manager__muted">
							{selectedProject()?.entries.length ?? 0} alveoli ·{' '}
							{selectedProject()?.roads.length ?? 0} roads · {selectedProject()?.stage}
						</div>
					</InspectorSection>

					<InspectorSection title="Contents">
						<div if={selectedProject()?.stage === 'draft'} class="project-manager__muted">
							Use a build tool then click the board to add alveoli/roads (placement wiring in
							progress).
						</div>
						<div class="project-manager__tree">
							<div class="project-manager__tree-row project-manager__tree-row--group">
								Alveoli ({selectedProject()?.entries.length ?? 0})
							</div>
							<for each={selectedProject()?.entries ?? []}>
								{(entry) => (
									<div class="project-manager__tree-row project-manager__tree-row--child">
										{entry.alveolusType}
										{entry.variant ? `#${entry.variant}` : ''} @ {entry.coord[0]},{entry.coord[1]}
									</div>
								)}
							</for>
							<for each={roadGroups()}>
								{(group) => (
									<fragment>
										<div class="project-manager__tree-row project-manager__tree-row--group">
											Road ({group.type}) — {group.coords.length} segments
										</div>
										<for each={group.coords}>
											{(coord) => (
												<div class="project-manager__tree-row project-manager__tree-row--child">
													{coord[0]},{coord[1]}
												</div>
											)}
										</for>
									</fragment>
								)}
							</for>
						</div>
					</InspectorSection>

					<InspectorSection title="Bill (goods)">
						<div class="project-manager__bill">
							<for each={billEntries()}>
								{(entry) => (
									<div class="project-manager__bill-row">
										<span>
											{entry.good}: {entry.delivered} / {entry.required}
										</span>
										<div class="project-manager__sourcing">
											<for each={SOURCING_MODES}>
												{(mode) => (
													<button
														type="button"
														disabled={selectedProject()?.stage === 'archived'}
														data-selected={
															sourcingModeFor(entry.good) === mode.value ? 'true' : 'false'
														}
														onClick={() => setSourcing(entry.good, mode.value)}
													>
														{mode.label}
													</button>
												)}
											</for>
										</div>
									</div>
								)}
							</for>
							<div if={billEntries().length === 0} class="project-manager__muted">
								No bill yet.
							</div>
						</div>
					</InspectorSection>

					<InspectorSection title="Progress">
						<div if={!progress()} class="project-manager__muted">
							Committed projects show live progress here.
						</div>
						<div if={!!progress()} class="project-manager__progress">
							<ConstructionProgressBar
								applied={progress()?.completed ?? 0}
								total={progress()?.total ?? 0}
								label={`${Math.round(((progress()?.completed ?? 0) * 100) / Math.max(1, progress()?.total ?? 0))}% complete`}
							/>
							<div
								if={Object.keys(progress()?.missingGoods ?? {}).length > 0}
								class="project-manager__muted"
							>
								Missing:{' '}
								{Object.entries(progress()?.missingGoods ?? {})
									.map(([good, qty]) => `${good} × ${qty}`)
									.join(', ')}
							</div>
							<for each={progress()?.items ?? []}>
								{(item) => (
									<div class="project-manager__progress-row">
										<span>
											{item.label} @ {item.coord[0]},{item.coord[1]}
										</span>
										<span class="project-manager__progress-state">{item.state}</span>
									</div>
								)}
							</for>
						</div>
					</InspectorSection>

					<InspectorSection title="Build tools">
						<div if={selectedProject()?.stage !== 'draft'} class="project-manager__muted">
							Only draft projects can be edited.
						</div>
						<div if={selectedProject()?.stage === 'draft'} class="project-manager__tools">
							<div
								class="project-manager__tool-group"
								data-collapsed={state.collapsed.hives ? 'true' : 'false'}
							>
								<button
									type="button"
									class="project-manager__tool-group-head"
									onClick={() => (state.collapsed.hives = !state.collapsed.hives)}
								>
									<span>Hives ({game.hivePlans.plans.length})</span>
									<span class="chevron">▾</span>
								</button>
								<div class="project-manager__tool-group-body">
									<div if={game.hivePlans.plans.length === 0} class="project-manager__muted">
										No hive plans yet — create one in the Plans panel.
									</div>
									<for each={game.hivePlans.plans}>
										{(hivePlan) => (
											<Button
												el={toolEl(
													interactionMode.selectedAction === 'hive' &&
														projectEditingState.hivePlan === hivePlan
												)}
												onClick={() => pickHive(hivePlan)}
											>
												{hivePlan.name}
											</Button>
										)}
									</for>
								</div>
								<div
									if={interactionMode.selectedAction === 'hive'}
									class="project-manager__hive-controls"
								>
									<Button
										onClick={() =>
											(projectEditingState.rotation = (projectEditingState.rotation + 5) % 6)
										}
									>
										Rotate ↺
									</Button>
									<Button
										onClick={() =>
											(projectEditingState.rotation = (projectEditingState.rotation + 1) % 6)
										}
									>
										Rotate ↻
									</Button>
									<Button
										onClick={() => (projectEditingState.mirror = !projectEditingState.mirror)}
									>
										Mirror
									</Button>
									<span>
										Rotation {projectEditingState.rotation * 60}deg ·{' '}
										{projectEditingState.mirror ? 'mirrored' : 'normal'}
									</span>
								</div>
							</div>

							<div
								class="project-manager__tool-group"
								data-collapsed={state.collapsed.alveoli ? 'true' : 'false'}
							>
								<button
									type="button"
									class="project-manager__tool-group-head"
									onClick={() => (state.collapsed.alveoli = !state.collapsed.alveoli)}
								>
									<span>
										Alveoli ({buildToolbarRoots.length} + {buildVariantEntries.length} variants)
									</span>
									<span class="chevron">▾</span>
								</button>
								<div class="project-manager__tool-group-body">
									<for each={buildToolbarRoots}>
										{(root) => (
											<Button
												el={toolEl(interactionMode.selectedAction === root.value)}
												onClick={() => pickTool(root.value)}
											>
												Build {root.label}
											</Button>
										)}
									</for>
									<for each={buildVariantEntries}>
										{(variant) => (
											<Button
												el={toolEl(interactionMode.selectedAction === variant.value)}
												onClick={() => pickTool(variant.value)}
											>
												{variant.label}
											</Button>
										)}
									</for>
								</div>
							</div>

							<div
								class="project-manager__tool-group"
								data-collapsed={state.collapsed.roads ? 'true' : 'false'}
							>
								<button
									type="button"
									class="project-manager__tool-group-head"
									onClick={() => (state.collapsed.roads = !state.collapsed.roads)}
								>
									<span>Roads ({ROAD_TYPES.length})</span>
									<span class="chevron">▾</span>
								</button>
								<div class="project-manager__tool-group-body">
									<for each={ROAD_TYPES}>
										{(type) => (
											<Button
												el={toolEl(interactionMode.selectedAction === `road:${type}`)}
												onClick={() => pickTool(`road:${type}`)}
											>
												Road {type}
											</Button>
										)}
									</for>
								</div>
							</div>

							<div
								class="project-manager__tool-group"
								data-collapsed={state.collapsed.bulldoze ? 'true' : 'false'}
							>
								<button
									type="button"
									class="project-manager__tool-group-head"
									onClick={() => (state.collapsed.bulldoze = !state.collapsed.bulldoze)}
								>
									<span>Actions</span>
									<span class="chevron">▾</span>
								</button>
								<div class="project-manager__tool-group-body">
									<Button
										el={toolEl(interactionMode.selectedAction === 'bulldoze')}
										onClick={() => pickTool('bulldoze')}
									>
										Bulldoze
									</Button>
								</div>
							</div>
						</div>
					</InspectorSection>

					<InspectorSection title="Actions">
						<div class="project-manager__actions">
							<Button if={canCommit()} onClick={commitSelected}>
								Commit
							</Button>
							<Button if={selectedProject()?.stage !== 'archived'} onClick={archiveSelected}>
								Archive
							</Button>
							<Button if={selectedProject()?.stage === 'archived'} onClick={unarchiveSelected}>
								Unarchive
							</Button>
						</div>
						<div if={state.message} class="project-manager__muted">
							{state.message}
						</div>
					</InspectorSection>
				</div>
			</div>
		</div>
	)
}

export default ProjectManagerWidget
