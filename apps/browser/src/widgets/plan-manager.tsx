import HivePlanCanvas from '@app/components/HivePlanCanvas'
import { css } from '@app/lib/css'
import { game, hivePlanPlacementState, interactionMode } from '@app/lib/globals'
import { Button, InspectorSection } from '@app/ui/anarkai'
import { effect, reactive } from 'mutts'
import { alveoli as alveoliRules } from 'engine-rules'
import type { HivePlan, HivePlanEntry, HivePlanStage } from 'ssh/hive-plan'
import {
	applyHivePlanToolAction,
	hivePlanEntryAt,
	validateHivePlanStructure,
} from 'ssh/hive-plan'
import type { AxialCoord } from 'ssh/utils/axial'
import type { AlveolusType } from 'ssh/types/base'

css`
.plan-manager {
	display: grid;
	grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
	gap: 0.75rem;
	height: 100%;
	padding: 0.75rem;
	box-sizing: border-box;
	color: var(--ak-text);
}

.plan-manager__sidebar,
.plan-manager__detail {
	min-width: 0;
	overflow: auto;
}

.plan-manager__filters,
.plan-manager__actions,
.plan-manager__cell-actions {
	display: flex;
	gap: 0.35rem;
	flex-wrap: wrap;
}

.plan-manager__filters {
	margin-block: 0.65rem;
}

.plan-manager__list {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.plan-manager__plan {
	text-align: left;
	padding: 0.45rem 0.55rem;
	border: 1px solid var(--ak-border);
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	border-radius: 0.35rem;
	cursor: pointer;
}

.plan-manager__plan[data-selected="true"],
.plan-manager__filter[data-selected="true"] {
	border-color: color-mix(in srgb, var(--ak-accent, #2563eb) 70%, var(--ak-border));
	background: color-mix(in srgb, var(--ak-accent, #2563eb) 12%, var(--ak-surface-panel));
}

.plan-manager__filter {
	border: 1px solid var(--ak-border);
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	border-radius: 999px;
	padding: 0.3rem 0.6rem;
	cursor: pointer;
}

.plan-manager__muted,
.plan-manager__issue {
	color: var(--ak-text-muted);
	font-size: 0.82rem;
}

.plan-manager__issue {
	color: #b45309;
}

.plan-manager__field,
.plan-manager__selected-cell {
	display: grid;
	gap: 0.35rem;
	margin-block: 0.5rem;
}

.plan-manager input,
.plan-manager select {
	box-sizing: border-box;
	width: 100%;
	padding: 0.35rem 0.45rem;
	border: 1px solid var(--ak-border);
	border-radius: 0.35rem;
	background: var(--ak-surface-panel);
	color: var(--ak-text);
}

.plan-manager__stage {
	text-transform: capitalize;
	font-size: 0.76rem;
	color: var(--ak-text-muted);
}

.plan-manager__canvas-wrap {
	min-height: 20rem;
	height: min(46vh, 28rem);
	border: 1px solid var(--ak-border);
	border-radius: 0.35rem;
	background:
		linear-gradient(transparent, transparent),
		var(--ak-surface-panel);
	overflow: hidden;
}

.hive-plan-canvas {
	width: 100%;
	height: 100%;
}

.hive-plan-canvas canvas {
	display: block;
	width: 100%;
	height: 100%;
}
`

type StageFilter = 'all' | HivePlanStage

const stageLabels: Record<HivePlanStage, string> = {
	working: 'Working',
	draft: 'Draft',
	validating: 'Validating',
	archived: 'Archived',
}
const planFilters: { value: StageFilter; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'working', label: 'Working' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'validating', label: 'Validating' },
	{ value: 'archived', label: 'Archived' },
]

const alveolusTypes = Object.keys(alveoliRules) as AlveolusType[]

function configurationOptions(alveolusType: AlveolusType): string[] {
	return ['', ...game.configurationManager.getNamedConfigurations(alveolusType).keys()]
}

function cloneEntry(entry: HivePlanEntry): HivePlanEntry {
	return {
		...entry,
		coord: [entry.coord[0], entry.coord[1]] as const,
		configuration: entry.configuration
			? {
					ref: { ...entry.configuration.ref },
					individual: entry.configuration.individual
						? { ...entry.configuration.individual }
						: undefined,
				}
			: undefined,
	}
}

function uniquePlanName(base: string): string {
	const names = new Set(game.hivePlans.plans.map((plan) => plan.name))
	if (!names.has(base)) return base
	let index = 2
	while (names.has(`${base} ${index}`)) index++
	return `${base} ${index}`
}

const PlanManagerWidget = (props: { title?: string }) => {
	props.title = 'Plans'
	const state = reactive({
		filter: 'all' as StageFilter,
		selectedId: '',
		selectedRoleId: '',
		message: '',
	})

	const plansForFilter = () =>
		state.filter === 'all'
			? game.hivePlans.plans
			: game.hivePlans.plans.filter((plan) => plan.stage === state.filter)
	const selectedPlan = () => game.hivePlans.find(state.selectedId)
	const selectedEntry = () => {
		const plan = selectedPlan()
		return plan?.entries.find((entry) => entry.roleId === state.selectedRoleId)
	}
	const selectedEntryConfigurationOptions = () => {
		const entry = selectedEntry()
		return entry ? configurationOptions(entry.alveolusType) : []
	}
	const structuralIssues = () => {
		const plan = selectedPlan()
		return plan ? validateHivePlanStructure(game, plan.entries) : []
	}
	const canValidate = () => {
		const plan = selectedPlan()
		return !!plan && plan.stage === 'draft' && structuralIssues().length === 0
	}

	effect`plan-manager:selected`(() => {
		const selected = selectedPlan()
		const list = plansForFilter()
		if (!selected && list[0]) state.selectedId = list[0].id
		if (selected && state.selectedRoleId) {
			const stillExists = selected.entries.some((entry) => entry.roleId === state.selectedRoleId)
			if (!stillExists) state.selectedRoleId = ''
		}
	})

	const setFilter = (filter: StageFilter) => {
		state.filter = filter !== 'all' && state.filter === filter ? 'all' : filter
		const list = plansForFilter()
		if (!list.some((plan) => plan.id === state.selectedId)) {
			state.selectedId = list[0]?.id ?? ''
			state.selectedRoleId = ''
		}
	}

	const createNewPlan = () => {
		const plan = game.hivePlans.createDraft(uniquePlanName('New hive plan'), [])
		state.filter = 'all'
		state.selectedId = plan.id
		state.selectedRoleId = ''
		state.message = 'New draft created.'
	}

	const applyDraftPatch = (
		plan: HivePlan,
		patch: { name?: string; entries?: readonly HivePlanEntry[] }
	): HivePlan | undefined => {
		if (plan.stage !== 'draft') {
			state.message = 'Only draft plans can be edited.'
			return
		}
		const result = game.hivePlans.updateDraft(plan.id, patch)
		if (result.id !== plan.id) {
			state.selectedId = result.id
			state.selectedRoleId = ''
			state.message = `Existing matching plan: ${result.name}`
			return result
		}
		state.message = ''
		return result
	}

	const setEntry = (roleId: string, patch: Partial<HivePlanEntry>) => {
		const plan = selectedPlan()
		if (!plan) return
		const entries = plan.entries.map((entry) =>
			entry.roleId === roleId ? { ...cloneEntry(entry), ...patch } : cloneEntry(entry)
		)
		const updated = applyDraftPatch(plan, { entries })
		if (patch.roleId && updated?.id === plan.id) state.selectedRoleId = patch.roleId
	}

	const setEntryNamedConfiguration = (roleId: string, name: string) => {
		if (!name) {
			setEntry(roleId, { configuration: undefined })
			return
		}
		setEntry(roleId, { configuration: { ref: { scope: 'named', name } } })
	}

	const handleCanvasHex = (coord: AxialCoord) => {
		const plan = selectedPlan()
		if (!plan) {
			state.message = 'Create or select a draft first.'
			return
		}
		const action = interactionMode.selectedAction
		const entry = hivePlanEntryAt(plan.entries, coord)
		if (!action.startsWith('build:') && action !== 'bulldoze') {
			state.selectedRoleId = entry?.roleId ?? ''
			return
		}
		if (plan.stage !== 'draft') {
			state.message = 'Only draft plans can be edited.'
			return
		}
		const next = applyHivePlanToolAction(plan.entries, action, coord)
		state.selectedRoleId = next.selectedRoleId ?? ''
		if (!next.changed) return
		const updated = applyDraftPatch(plan, { entries: next.entries })
		if (updated?.id === plan.id) state.selectedRoleId = next.selectedRoleId ?? ''
	}

	const validateSelected = () => {
		const plan = selectedPlan()
		if (!plan || !canValidate()) return
		const result = game.hivePlans.sendToValidation(plan.id)
		if (!result.ok) {
			state.message = 'Plan is not ready for validation.'
			return
		}
		state.filter = 'validating'
		state.message = `${result.plan.name} sent to engineer validation.`
	}

	const archiveSelected = () => {
		const plan = selectedPlan()
		if (!plan) return
		game.hivePlans.archive(plan.id)
		state.message = `${plan.name} archived.`
	}

	const unarchiveSelected = () => {
		const plan = selectedPlan()
		if (!plan) return
		game.hivePlans.unarchive(plan.id)
		state.message = `${plan.name} restored as draft.`
	}

	const placeSelected = () => {
		const plan = selectedPlan()
		if (!plan || plan.stage !== 'working') return
		interactionMode.selectedAction = `hive-plan:${plan.id}`
		hivePlanPlacementState.rotation = 0
		hivePlanPlacementState.lastMessage = 'Click the board to place the plan.'
	}

	const rotatePlacement = (delta: number) => {
		hivePlanPlacementState.rotation = (hivePlanPlacementState.rotation + delta + 6) % 6
	}

	return (
		<div class="plan-manager">
			<div class="plan-manager__sidebar">
				<Button onClick={createNewPlan}>New</Button>
				<div class="plan-manager__filters">
					<for each={planFilters}>
						{(filter) => (
							<button
								type="button"
								class="plan-manager__filter"
								data-selected={state.filter === filter.value ? 'true' : 'false'}
								onClick={() => setFilter(filter.value)}
							>
								{filter.label}
							</button>
						)}
					</for>
				</div>
				<div class="plan-manager__list">
					<for each={plansForFilter()}>
						{(plan) => (
							<button
								type="button"
								class="plan-manager__plan"
								data-selected={state.selectedId === plan.id ? 'true' : 'false'}
								onClick={() => {
									state.selectedId = plan.id
									state.selectedRoleId = ''
								}}
							>
								<div>{plan.name}</div>
								<div class="plan-manager__stage">
									{plan.entries.length} alveoli · {stageLabels[plan.stage as HivePlanStage]}
								</div>
							</button>
						)}
					</for>
					<div if={plansForFilter().length === 0} class="plan-manager__muted">
						No plans in this filter.
					</div>
				</div>
			</div>
			<div class="plan-manager__detail">
				<InspectorSection title="Designer">
					<div if={!selectedPlan()} class="plan-manager__muted">
						Create or select a plan.
					</div>
					<div if={!!selectedPlan()}>
						<div class="plan-manager__field">
							<label>Name</label>
							<input
								value={selectedPlan()?.name ?? ''}
								disabled={selectedPlan()?.stage !== 'draft'}
								onInput={(event) => {
									const plan = selectedPlan()
									if (!plan) return
									applyDraftPatch(plan, {
										name: (event.currentTarget as HTMLInputElement).value,
									})
								}}
							/>
						</div>
						<div class="plan-manager__canvas-wrap">
							<HivePlanCanvas
								plan={selectedPlan()}
								issues={structuralIssues()}
								selectedRoleId={state.selectedRoleId}
								selectedAction={interactionMode.selectedAction}
								readOnly={selectedPlan()?.stage !== 'draft'}
								onHexClick={handleCanvasHex}
							/>
						</div>
						<div class="plan-manager__muted">
							Tool: {interactionMode.selectedAction || 'Select'} · {selectedPlan()?.stage}
						</div>
						<for each={structuralIssues()}>
							{(issue) => <div class="plan-manager__issue">{issue.message}</div>}
						</for>
					</div>
				</InspectorSection>

				<InspectorSection title="Selected cell">
					<div if={!selectedEntry()} class="plan-manager__muted">
						Select a plan cell on the canvas.
					</div>
					<div if={!!selectedEntry()} class="plan-manager__selected-cell">
						<label>Role</label>
						<input
							value={selectedEntry()?.roleId ?? ''}
							disabled={selectedPlan()?.stage !== 'draft'}
							onInput={(event) => {
								const entry = selectedEntry()
								if (!entry) return
								setEntry(entry.roleId, {
									roleId: (event.currentTarget as HTMLInputElement).value,
								})
							}}
						/>
						<label>Alveolus</label>
						<select
							value={selectedEntry()?.alveolusType ?? ''}
							disabled={selectedPlan()?.stage !== 'draft'}
							onChange={(event) => {
								const entry = selectedEntry()
								if (!entry) return
								setEntry(entry.roleId, {
									alveolusType: (event.currentTarget as HTMLSelectElement)
										.value as AlveolusType,
									configuration: undefined,
								})
							}}
						>
							<for each={alveolusTypes}>
								{(type) => <option value={type}>{type}</option>}
							</for>
						</select>
						<label>Configuration</label>
						<select
							value={
								selectedEntry()?.configuration?.ref.scope === 'named'
									? selectedEntry()?.configuration?.ref.name
									: ''
							}
							disabled={selectedPlan()?.stage !== 'draft'}
							onChange={(event) => {
								const entry = selectedEntry()
								if (!entry) return
								setEntryNamedConfiguration(
									entry.roleId,
									(event.currentTarget as HTMLSelectElement).value
								)
							}}
						>
							<option value="">Hive/default config</option>
							<for each={selectedEntryConfigurationOptions()}>
								{(name) => (
									<option if={!!name} value={name}>
										{name}
									</option>
								)}
							</for>
						</select>
					</div>
				</InspectorSection>

				<InspectorSection title="Plan actions">
					<div if={!!selectedPlan()}>
						<div class="plan-manager__muted">
							{selectedPlan()?.entries.length} alveoli · {selectedPlan()?.stage}
						</div>
						<div if={selectedPlan()?.stage === 'validating'} class="plan-manager__muted">
							Research {Math.floor(selectedPlan()?.validationProgress.workSecondsApplied ?? 0)} /{' '}
							{selectedPlan()?.validationProgress.workSecondsRequired ?? 0}s
						</div>
						<div class="plan-manager__actions">
							<Button
								if={selectedPlan()?.stage === 'draft'}
								disabled={!canValidate()}
								onClick={validateSelected}
							>
								Validate
							</Button>
							<Button if={selectedPlan()?.stage === 'working'} onClick={placeSelected}>
								Place
							</Button>
							<Button if={selectedPlan()?.stage !== 'archived'} onClick={archiveSelected}>
								Archive
							</Button>
							<Button if={selectedPlan()?.stage === 'archived'} onClick={unarchiveSelected}>
								Unarchive
							</Button>
							<Button onClick={() => rotatePlacement(-1)}>Rotate left</Button>
							<Button onClick={() => rotatePlacement(1)}>Rotate right</Button>
						</div>
						<div class="plan-manager__muted">
							Placement rotation: {hivePlanPlacementState.rotation * 60}deg
						</div>
						<div class="plan-manager__muted">{hivePlanPlacementState.lastMessage}</div>
					</div>
					<div if={state.message} class="plan-manager__muted">
						{state.message}
					</div>
				</InspectorSection>
			</div>
		</div>
	)
}

export default PlanManagerWidget
