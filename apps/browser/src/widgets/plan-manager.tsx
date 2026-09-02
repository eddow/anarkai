import HivePlanCanvas from '@app/components/HivePlanCanvas'
import { variantDisplayLabel } from '@app/components/properties/VariantPicker'
import { css } from '@app/lib/css'
import { game, interactionMode } from '@app/lib/globals'
import { Button, InspectorSection } from '@app/ui/anarkai'
import { alveoli as alveoliRules } from 'engine-rules'
import { effect, reactive } from 'mutts'
import type { HivePlan, HivePlanEntry } from 'ssh/hive-plan'
import {
	applyHivePlanToolAction,
	hivePlanCoordKey,
	hivePlanEntryAt,
	validateHivePlanStructure,
} from 'ssh/hive-plan'
import type { AlveolusType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'

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

interface PlanVariantOption {
	value: string
	label: string
}

function planEntryVariantOptions(alveolusType: string): PlanVariantOption[] {
	const def = (alveoliRules as any)[alveolusType]
	if (!def || !def.variants) return []
	const options: PlanVariantOption[] = []
	const walk = (prefix: string, variants: Record<string, any>) => {
		for (const [key, vdef] of Object.entries(variants)) {
			const fullId = prefix ? `${prefix}.${key}` : key
			const label = variantDisplayLabel(key)
			options.push({ value: fullId, label })
			if (vdef.variants) walk(fullId, vdef.variants)
		}
	}
	walk('', def.variants)
	return options
}

const PlanManagerWidget = (props: { title?: string }) => {
	props.title = 'Plans'
	const state = reactive({
		selectedPlan: undefined as HivePlan | undefined,
		selectedCoord: undefined as readonly [number, number] | undefined,
		message: '',
	})

	const selectedPlan = () => state.selectedPlan
	const selectedEntry = () => {
		const plan = selectedPlan()
		return plan && state.selectedCoord
			? hivePlanEntryAt(plan.entries, state.selectedCoord)
			: undefined
	}
	const selectedEntryConfigurationOptions = () => {
		const entry = selectedEntry()
		return entry ? configurationOptions(entry.alveolusType) : []
	}
	const structuralIssues = () => {
		const plan = selectedPlan()
		return plan ? validateHivePlanStructure(game, plan.entries) : []
	}

	effect`plan-manager:selected`(() => {
		const selected = selectedPlan()
		if (!selected && game.hivePlans.plans[0]) state.selectedPlan = game.hivePlans.plans[0]
		if (selected && state.selectedCoord) {
			const stillExists = selected.entries.some(
				(entry) => hivePlanCoordKey(entry.coord) === hivePlanCoordKey(state.selectedCoord!)
			)
			if (!stillExists) state.selectedCoord = undefined
		}
	})

	const createNewPlan = () => {
		const plan = game.hivePlans.create(uniquePlanName('New hive plan'), [])
		state.selectedPlan = plan
		state.selectedCoord = undefined
		state.message = 'New template created.'
	}

	const deleteSelected = () => {
		const plan = selectedPlan()
		if (!plan) return
		game.hivePlans.remove(plan)
		if (state.selectedPlan === plan) state.selectedPlan = undefined
		state.selectedCoord = undefined
		state.message = `${plan.name} deleted.`
	}

	const applyPatch = (
		plan: HivePlan,
		patch: { name?: string; entries?: readonly HivePlanEntry[] }
	): HivePlan | undefined => {
		const result = game.hivePlans.update(plan, patch)
		if (result !== plan) {
			state.selectedPlan = result
			state.selectedCoord = undefined
			state.message = `Existing matching template: ${result.name}`
			return result
		}
		state.message = ''
		return result
	}

	const setEntry = (coord: readonly [number, number], patch: Partial<HivePlanEntry>) => {
		const plan = selectedPlan()
		if (!plan) return
		const key = hivePlanCoordKey(coord)
		const entries = plan.entries.map((entry) =>
			hivePlanCoordKey(entry.coord) === key ? { ...cloneEntry(entry), ...patch } : cloneEntry(entry)
		)
		applyPatch(plan, { entries })
	}

	const setEntryNamedConfiguration = (coord: readonly [number, number], name: string) => {
		if (!name) {
			setEntry(coord, { configuration: undefined })
			return
		}
		setEntry(coord, { configuration: { ref: { scope: 'named', name } } })
	}

	const handleCanvasHex = (coord: AxialCoord) => {
		const plan = selectedPlan()
		if (!plan) {
			state.message = 'Create or select a template first.'
			return
		}
		const action = interactionMode.selectedAction
		const entry = hivePlanEntryAt(plan.entries, coord)
		if (!action.startsWith('build:') && action !== 'bulldoze') {
			state.selectedCoord = entry ? ([entry.coord[0], entry.coord[1]] as const) : undefined
			return
		}
		const next = applyHivePlanToolAction(plan.entries, action, coord)
		state.selectedCoord = next.selectedCoord ?? undefined
		if (!next.changed) return
		applyPatch(plan, { entries: next.entries })
	}

	return (
		<div class="plan-manager">
			<div class="plan-manager__sidebar">
				<Button onClick={createNewPlan}>New</Button>
				<div class="plan-manager__list">
					<for each={game.hivePlans.plans}>
						{(plan) => (
							<button
								type="button"
								class="plan-manager__plan"
								data-selected={state.selectedPlan === plan ? 'true' : 'false'}
								onClick={() => {
									state.selectedPlan = plan
									state.selectedCoord = undefined
								}}
							>
								<div>{plan.name}</div>
								<div class="plan-manager__stage">{plan.entries.length} alveoli</div>
							</button>
						)}
					</for>
					<div if={game.hivePlans.plans.length === 0} class="plan-manager__muted">
						No templates yet.
					</div>
				</div>
			</div>
			<div class="plan-manager__detail">
				<InspectorSection title="Template">
					<div if={!selectedPlan()} class="plan-manager__muted">
						Create or select a template.
					</div>
					<div if={!!selectedPlan()}>
						<div class="plan-manager__field">
							<label>Name</label>
							<input
								value={selectedPlan()?.name ?? ''}
								update:value={(v: string) => {
									const plan = selectedPlan()
									if (!plan) return
									applyPatch(plan, {
										name: v,
									})
								}}
							/>
						</div>
						<div class="plan-manager__canvas-wrap">
							<HivePlanCanvas
								plan={selectedPlan()}
								issues={structuralIssues()}
								selectedCoord={state.selectedCoord}
								selectedAction={interactionMode.selectedAction}
								readOnly={false}
								onHexClick={handleCanvasHex}
							/>
						</div>
						<div class="plan-manager__muted">
							Tool: {interactionMode.selectedAction || 'Select'}
						</div>
						<for each={structuralIssues()}>
							{(issue) => <div class="plan-manager__issue">{issue.message}</div>}
						</for>
						<div class="plan-manager__actions">
							<Button onClick={deleteSelected}>Delete</Button>
						</div>
					</div>
				</InspectorSection>

				<InspectorSection title="Selected cell">
					<div if={!selectedEntry()} class="plan-manager__muted">
						Select a plan cell on the canvas.
					</div>
					<div if={!!selectedEntry()} class="plan-manager__selected-cell">
						<label>Alveolus</label>
						<select
							value={selectedEntry()?.alveolusType ?? ''}
							update:value={(v: string) => {
								const entry = selectedEntry()
								if (!entry) return
								setEntry(entry.coord, {
									alveolusType: v as AlveolusType,
									configuration: undefined,
									variant: undefined,
								})
							}}
						>
							<for each={alveolusTypes}>{(type) => <option value={type}>{type}</option>}</for>
						</select>
						<label if={planEntryVariantOptions(selectedEntry()?.alveolusType ?? '').length > 0}>
							Variant
						</label>
						<select
							if={planEntryVariantOptions(selectedEntry()?.alveolusType ?? '').length > 0}
							update:value={(v: string) => {
								const entry = selectedEntry()
								if (!entry) return
								const newValue = v
								setEntry(entry.coord, {
									variant: newValue || undefined,
								})
							}}
						>
							<option value="" selected={!selectedEntry()?.variant}>
								(none)
							</option>
							<for each={planEntryVariantOptions(selectedEntry()?.alveolusType ?? '')}>
								{(opt) => (
									<option value={opt.value} selected={selectedEntry()?.variant === opt.value}>
										{opt.label}
									</option>
								)}
							</for>
						</select>
						<label>Configuration</label>
						<select
							value={
								selectedEntry()?.configuration?.ref.scope === 'named'
									? selectedEntry()?.configuration?.ref.name
									: ''
							}
							update:value={(v: string) => {
								const entry = selectedEntry()
								if (!entry) return
								setEntryNamedConfiguration(entry.coord, v)
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

				<div if={state.message} class="plan-manager__muted">
					{state.message}
				</div>
			</div>
		</div>
	)
}

export default PlanManagerWidget
