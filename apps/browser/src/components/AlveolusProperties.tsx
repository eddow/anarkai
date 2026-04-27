import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { selectInspectorObject } from '@app/lib/follow-selection'
import { getTranslator } from '@app/lib/i18n'
import { effect, reactive } from 'mutts'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { queryConstructionSiteView } from 'ssh/construction'
import { collectDockedVehiclesForBay, type DockedVehicleEntry } from 'ssh/freight/docked-vehicles'
import {
	createExplicitFreightLineDraftForFreightBay,
	createSyntheticFreightLineObject,
	type FreightLineMode,
	findFreightLinesForStop,
	normalizeFreightLineDefinition,
	type SyntheticFreightLineObject,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { StorageAlveolus } from 'ssh/hive/storage'
import { isRoadFretAction } from 'ssh/hive/storage-action'
import ConstructionProgressBar from './ConstructionProgressBar'
import DockedVehicleList from './DockedVehicleList'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGridRow from './PropertyGridRow'
import WorkingIndicator from './parts/WorkingIndicator'
import StorageConfiguration from './storage/StorageConfiguration'
import StoredGoodsRow from './storage/StoredGoodsRow'

css`
.alveolus-commands {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}
.alveolus-line-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.alveolus-line-list__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
	padding: 0.35rem 0.55rem;
	border-radius: 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 16%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
}
.alveolus-line-list__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.45rem;
	align-items: center;
	margin-top: 0.25rem;
}
.alveolus-freight-bay__btn {
	padding: 0.35rem 0.55rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.8rem;
}
.alveolus-freight-bay__btn--primary {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 35%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 10%, var(--ak-surface-panel));
}
`

interface AlveolusPropertiesProps {
	content: Alveolus
	game?: Game
}

const AlveolusProperties = (props: AlveolusPropertiesProps) => {
	const state = reactive({
		working: false,
		isStorage: false,
		isFreightBay: false,
		storageContent: undefined as StorageAlveolus | undefined,
		lineObjects: [] as SyntheticFreightLineObject[],
		dockedVehicles: [] as DockedVehicleEntry[],
		resolvedGame: undefined as Game | undefined,
		isBuildSite: false,
		constructionPhaseLabel: '',
		constructionBlocking: [] as string[],
		constructionWorkLine: '',
		constructionApplied: 0,
		constructionTotal: 0,
		showConstruction: false,
	})

	effect`alveolus-properties:storage-check`(() => {
		const content = props.content
		const game = props.game ?? content?.game
		const freightLines = game?.freightLines ?? []
		void freightLines.length
		state.resolvedGame = game
		state.isStorage = content instanceof StorageAlveolus
		state.storageContent = content instanceof StorageAlveolus ? content : undefined
		state.isFreightBay =
			content instanceof StorageAlveolus &&
			isRoadFretAction(content.action) &&
			content.name === 'freight_bay'
		state.working = content?.working ?? false
		state.lineObjects =
			game && content
				? findFreightLinesForStop(freightLines, content).map((line) =>
						createSyntheticFreightLineObject(game, line)
					)
				: []
		state.dockedVehicles =
			game && content instanceof StorageAlveolus && state.isFreightBay
				? collectDockedVehiclesForBay(game, content)
				: []
	})

	effect`alveolus-properties:construction`(() => {
		const game = state.resolvedGame
		const content = props.content
		if (!game || !(content instanceof BuildAlveolus)) {
			state.showConstruction = false
			state.isBuildSite = false
			state.constructionPhaseLabel = ''
			state.constructionBlocking = []
			state.constructionWorkLine = ''
			state.constructionApplied = 0
			state.constructionTotal = 0
			return
		}
		state.isBuildSite = true
		const snap = queryConstructionSiteView(game, content.tile)
		if (!snap) {
			state.showConstruction = false
			return
		}
		state.showConstruction = true
		const model = buildConstructionViewModel(snap, getTranslator() as ConstructionTranslatorShape)
		state.constructionPhaseLabel = model.phaseLabel
		state.constructionBlocking = model.blockingLabels
		state.constructionApplied = model.applied
		state.constructionTotal = model.total
		state.constructionWorkLine = model.workLine
	})

	const handleWorkingChange = (checked: boolean) => {
		if (!props.content) return
		props.content.working = checked
		state.working = checked
	}

	const bayTranslator = () => getTranslator().bay

	const handleAddFreightLine = (mode: FreightLineMode) => {
		const game = state.resolvedGame
		const content = props.content
		if (!game || !(content instanceof StorageAlveolus) || !state.isFreightBay) return
		const draft = createExplicitFreightLineDraftForFreightBay(content, mode)
		if (!draft) return
		game.replaceFreightLine(draft)
		const merged =
			game.freightLines.find((line) => line.id === draft.id) ??
			normalizeFreightLineDefinition(draft)
		selectInspectorObject(createSyntheticFreightLineObject(game, merged))
	}

	return (
		<>
			<PropertyGridRow label={getTranslator().alveolus.commands}>
				<div class="alveolus-commands">
					<WorkingIndicator
						checked={state.working}
						tooltip={getTranslator().alveolus.workingTooltip}
						onChange={handleWorkingChange}
					/>
				</div>
			</PropertyGridRow>

			<PropertyGridRow
				if={state.showConstruction && state.isBuildSite}
				label={String(getTranslator().construction.section)}
			>
				<div class="alveolus-commands">
					<div style="display:grid; gap:0.5rem; width:100%;">
						<div class="alveolus-commands">
							<span>{state.constructionPhaseLabel}</span>
							<for each={state.constructionBlocking}>
								{(text) => <span style="color: var(--ak-text-muted)"> · {text}</span>}
							</for>
						</div>
						<ConstructionProgressBar
							if={state.constructionTotal > 0}
							applied={state.constructionApplied}
							total={state.constructionTotal}
							label={state.constructionWorkLine}
							testId="alveolus-construction-progress"
						/>
					</div>
				</div>
			</PropertyGridRow>

			<PropertyGridRow
				if={state.isFreightBay && state.resolvedGame}
				label={bayTranslator().linesAtThisBay}
			>
				<div class="alveolus-line-list">
					<for each={state.lineObjects}>
						{(lineObject) => (
							<div class="alveolus-line-list__item">
								<LinkedEntityControl object={lineObject} />
								<InspectorObjectLink object={lineObject} />
							</div>
						)}
					</for>
					<div class="alveolus-line-list__actions">
						<button
							type="button"
							class="alveolus-freight-bay__btn alveolus-freight-bay__btn--primary"
							data-testid="freight-bay-add-gather"
							onClick={() => handleAddFreightLine('gather')}
						>
							{bayTranslator().addGather}
						</button>
						<button
							type="button"
							class="alveolus-freight-bay__btn alveolus-freight-bay__btn--primary"
							data-testid="freight-bay-add-distribute"
							onClick={() => handleAddFreightLine('distribute')}
						>
							{bayTranslator().addDistribute}
						</button>
					</div>
				</div>
			</PropertyGridRow>

			<PropertyGridRow
				if={state.isFreightBay && state.dockedVehicles.length > 0}
				label={getTranslator().vehicle.docked}
			>
				<DockedVehicleList entries={state.dockedVehicles} showLineMeta />
			</PropertyGridRow>

			<PropertyGridRow
				if={!state.isFreightBay && state.lineObjects.length > 0}
				label={
					state.lineObjects.length > 1
						? getTranslator().line.linesSection
						: getTranslator().line.section
				}
			>
				<div class="alveolus-line-list">
					<for each={state.lineObjects}>
						{(lineObject) => (
							<div class="alveolus-line-list__item">
								<LinkedEntityControl object={lineObject} />
								<InspectorObjectLink object={lineObject} />
							</div>
						)}
					</for>
				</div>
			</PropertyGridRow>

			<StoredGoodsRow
				if={state.resolvedGame}
				content={props.content}
				game={state.resolvedGame!}
				label={
					state.isBuildSite ? getTranslator().construction.materials : getTranslator().goods.stored
				}
			/>

			<StorageConfiguration
				if={state.isStorage && state.resolvedGame}
				content={state.storageContent!}
				game={state.resolvedGame!}
			/>
		</>
	)
}

export default AlveolusProperties
