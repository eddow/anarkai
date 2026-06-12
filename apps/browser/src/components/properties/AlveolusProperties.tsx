import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { selectInspectorObject } from '@app/lib/follow-selection'
import { T } from '@app/lib/i18n'
import { presentationRevisionFor } from '@app/lib/presentation-events'
import { effect, reactive } from 'mutts'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { zoneObjectUid } from 'ssh/board/zone'
import { isConstructionSiteShell } from 'ssh/build-site'
import { queryConstructionSiteView } from 'ssh/construction'
import { collectDockedVehiclesForBay, type DockedVehicleEntry } from 'ssh/freight/docked-vehicles'
import {
	createExchangeFreightLineDraftForFreightBay,
	createSyntheticFreightLineObject,
	findFreightLinesForStop,
	normalizeFreightLineDefinition,
	type SyntheticFreightLineObject,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import { ForesterAlveolus } from 'ssh/hive/forester'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { StorageAlveolus } from 'ssh/hive/storage'
import { TransformAlveolus } from 'ssh/hive/transform'
import type { GoodType } from 'ssh/types/base'
import ComboDropdownPicker from '../ComboDropdownPicker'
import ConstructionProgressBar from '../ConstructionProgressBar'
import DockedVehicleList from '../DockedVehicleList'
import InspectorObjectLink from '../InspectorObjectLink'
import LinkedEntityControl from '../LinkedEntityControl'
import PropertyGridRow from '../PropertyGridRow'
import StorageConfiguration from '../storage/StorageConfiguration'
import StoredGoodsRow from '../storage/StoredGoodsRow'

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
.alveolus-transform-ratio {
	display: grid;
	gap: 0.45rem;
	width: 100%;
}
.alveolus-transform-ratio__goods {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 0.45rem;
}
.alveolus-transform-ratio__select {
	min-width: 0;
	width: 100%;
	padding: 0.25rem 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	border-radius: 0.35rem;
	background: var(--ak-surface-panel);
	color: var(--ak-text);
}
.alveolus-transform-ratio__slider {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 3rem;
	gap: 0.5rem;
	align-items: center;
}
.alveolus-transform-ratio__value {
	color: var(--ak-text-muted);
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.alveolus-zone-assignment {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
	align-items: center;
}
.alveolus-zone-assignment__chip {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.25rem 0.45rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 20%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
}
.alveolus-zone-assignment__remove {
	border: 0;
	background: transparent;
	color: var(--ak-text-muted);
	cursor: pointer;
	padding: 0;
	font-size: 0.9rem;
	line-height: 1;
}
`

interface AlveolusPropertiesProps {
	content: Alveolus
	game?: Game
}

const AlveolusProperties = (props: AlveolusPropertiesProps) => {
	const state = reactive({
		isStorage: false,
		isFreightBay: false,
		isTransform: false,
		isForester: false,
		storageContent: undefined as StorageAlveolus | undefined,
		transformContent: undefined as TransformAlveolus | undefined,
		lineObjects: [] as SyntheticFreightLineObject[],
		dockedVehicles: [] as DockedVehicleEntry[],
		resolvedGame: undefined as Game | undefined,
		isBuildSite: false,
		constructionPhaseLabel: '',
		constructionBlocking: [] as string[],
		constructionWorkLine: '',
		constructionApplied: 0,
		constructionTotal: 0,
		constructionTarget: '',
		showConstruction: false,
	})

	effect`alveolus-properties:storage-check`(() => {
		const content = props.content
		const game = props.game ?? content?.game
		const freightLines = game?.freightLines ?? []
		void freightLines.length
		state.resolvedGame = game
		state.isStorage = content instanceof StorageAlveolus
		state.isTransform = content instanceof TransformAlveolus
		state.isForester = content instanceof ForesterAlveolus
		state.storageContent = content instanceof StorageAlveolus ? content : undefined
		state.transformContent = content instanceof TransformAlveolus ? content : undefined
		state.isFreightBay = content instanceof FreightBayAlveolus
		state.lineObjects =
			game && content
				? findFreightLinesForStop(freightLines, content).map((line) =>
						createSyntheticFreightLineObject(game, line)
					)
				: []
		state.dockedVehicles =
			game && content instanceof FreightBayAlveolus
				? collectDockedVehiclesForBay(game, content)
				: []
	})

	effect`alveolus-properties:construction`(() => {
		const game = state.resolvedGame
		const content = props.content
		if (!game || !isConstructionSiteShell(content)) {
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
		const model = buildConstructionViewModel(snap, T as ConstructionTranslatorShape)
		state.constructionPhaseLabel = model.phaseLabel
		state.constructionBlocking = model.blockingLabels
		state.constructionApplied = model.applied
		state.constructionTotal = model.total
		state.constructionWorkLine = model.workLine
		state.constructionTarget = model.targetDisplay
	})

	const bayTranslator = () => T.bay

	const processBufferEntries = () => {
		const transform = state.transformContent
		if (!transform) return []
		presentationRevisionFor(transform.tile?.uid)
		return transform.rateEntries.map(([goodType, rate]) => ({
			goodType,
			rate,
			value: transform.processBuffer(goodType),
		}))
	}

	const processBufferLabel = (goodType: GoodType, value: number) =>
		`${goodType} ${Math.round(value * 100)}%`

	const transformRatioConfig = () => state.transformContent?.transformConfiguration.productRatio
	const transformInputGoods = () => state.transformContent?.consumedGoods ?? []
	const transformOutputGoods = () => state.transformContent?.producedGoods ?? []
	const transformRatioInputGood = () =>
		(transformRatioConfig()?.inputGood as GoodType | undefined) ?? transformInputGoods()[0]
	const transformRatioOutputGood = () =>
		(transformRatioConfig()?.outputGood as GoodType | undefined) ?? transformOutputGoods()[0]
	const transformRatioValue = () => transformRatioConfig()?.maxProductRatio ?? 0
	const transformRatioPercent = () => Math.round(transformRatioValue() * 100)
	const setTransformRatio = (patch: Partial<Ssh.TransformProductRatioConfiguration>) => {
		const transform = state.transformContent
		if (!transform) return
		const inputGood = (patch.inputGood as GoodType | undefined) ?? transformRatioInputGood()
		const outputGood = (patch.outputGood as GoodType | undefined) ?? transformRatioOutputGood()
		if (!inputGood || !outputGood) return
		transform.setProductRatioConfiguration({
			inputGood,
			outputGood,
			maxProductRatio: patch.maxProductRatio ?? transformRatioValue(),
		})
	}

	const handleAddFreightLine = () => {
		const game = state.resolvedGame
		const content = props.content
		if (!game || !(content instanceof FreightBayAlveolus)) return
		const draft = createExchangeFreightLineDraftForFreightBay(content)
		if (!draft) return
		game.replaceFreightLine(draft)
		const merged =
			game.freightLines.find((line) => line.id === draft.id) ??
			normalizeFreightLineDefinition(draft)
		selectInspectorObject(createSyntheticFreightLineObject(game, merged))
	}

	const assignedZoneIds = () => props.content?.assignedZoneIds ?? []
	const customZones = () => state.resolvedGame?.hex.zoneManager.listCustomZoneDefinitions() ?? []
	const zoneDefinition = (zoneId: string) =>
		state.resolvedGame?.hex.zoneManager.getZoneDefinition(zoneId)
	const zoneObject = (zoneId: string) => state.resolvedGame?.getObject(zoneObjectUid(zoneId))
	const zonePickerItems = () =>
		customZones()
			.filter((zone) => !assignedZoneIds().includes(zone.id))
			.map((zone) => ({ id: zone.id, label: zone.name?.trim() || zone.id }))
	const assignZone = (zoneId: string) => {
		props.content?.addAssignedZoneId?.(zoneId)
	}
	const removeZone = (zoneId: string) => {
		props.content?.removeAssignedZoneId?.(zoneId)
	}

	return (
		<>
			<PropertyGridRow
				if={state.showConstruction && state.isBuildSite}
				label={String(T.construction.section)}
			>
				<div class="alveolus-commands">
					<div style="display:grid; gap:0.5rem; width:100%;">
						<div class="alveolus-commands">
							<span>{state.constructionPhaseLabel}</span>
							<span
								if={state.constructionTarget.length > 0}
								style="color: var(--ak-accent, #8b5cf6);"
							>
								· {state.constructionTarget}
							</span>
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
							data-testid="freight-bay-add-line"
							title={bayTranslator().addLineHint}
							onClick={handleAddFreightLine}
						>
							{bayTranslator().addLine}
						</button>
					</div>
				</div>
			</PropertyGridRow>

			<PropertyGridRow
				if={state.isFreightBay && state.dockedVehicles.length > 0}
				label={T.vehicle.docked}
			>
				<DockedVehicleList entries={state.dockedVehicles} showLineMeta game={state.resolvedGame} />
			</PropertyGridRow>

			<PropertyGridRow
				if={!state.isFreightBay && state.lineObjects.length > 0}
				label={state.lineObjects.length > 1 ? T.line.linesSection : T.line.section}
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

			<PropertyGridRow
				if={state.isTransform && processBufferEntries().length > 0}
				label={String(T.alveolus.process)}
			>
				<div style="display:grid; gap:0.5rem; width:100%;">
					<for each={processBufferEntries()}>
						{(entry) => (
							<ConstructionProgressBar
								applied={entry.value}
								total={1}
								label={processBufferLabel(entry.goodType, entry.value)}
								testId={`alveolus-process-buffer-${entry.goodType}`}
							/>
						)}
					</for>
				</div>
			</PropertyGridRow>

			<PropertyGridRow
				if={state.isTransform && !!transformRatioConfig()}
				label={String(T.alveolus.productRatio)}
			>
				<div class="alveolus-transform-ratio">
					<div class="alveolus-transform-ratio__goods">
						<select
							class="alveolus-transform-ratio__select"
							data-testid="transform-ratio-input-good"
							title={String(T.alveolus.productRatioInput)}
							value={transformRatioInputGood()}
							update:value={(v: string) => setTransformRatio({ inputGood: v })}
						>
							<for each={transformInputGoods()}>
								{(goodType) => <option value={goodType}>{goodType}</option>}
							</for>
						</select>
						<select
							class="alveolus-transform-ratio__select"
							data-testid="transform-ratio-output-good"
							title={String(T.alveolus.productRatioOutput)}
							value={transformRatioOutputGood()}
							update:value={(v: string) => setTransformRatio({ outputGood: v })}
						>
							<for each={transformOutputGoods()}>
								{(goodType) => <option value={goodType}>{goodType}</option>}
							</for>
						</select>
					</div>
					<div class="alveolus-transform-ratio__slider">
						<input
							type="range"
							min="0"
							max="100"
							step="1"
							value={String(transformRatioPercent())}
							data-testid="transform-ratio-slider"
							title={String(T.alveolus.productRatio)}
							update:value={(v: number) => setTransformRatio({ maxProductRatio: v / 100 })}
						/>
					</div>
				</div>
			</PropertyGridRow>

			<PropertyGridRow if={state.isForester && state.resolvedGame} label="Assigned zones">
				<div class="alveolus-zone-assignment">
					<for each={assignedZoneIds()}>
						{(zoneId) => (
							<span class="alveolus-zone-assignment__chip" data-testid="forester-zone-chip">
								<InspectorObjectLink
									object={zoneObject(zoneId)}
									label={zoneDefinition(zoneId)?.name?.trim() || zoneId}
								/>
								<button
									type="button"
									class="alveolus-zone-assignment__remove"
									title="Remove zone"
									aria-label={`Remove ${zoneDefinition(zoneId)?.name?.trim() || zoneId}`}
									data-testid={`forester-zone-remove-${zoneId}`}
									onClick={() => removeZone(zoneId)}
								>
									x
								</button>
							</span>
						)}
					</for>
					<ComboDropdownPicker
						mode="value"
						valueLabel="Add zone"
						title="Add assigned zone"
						ariaLabel="Add assigned zone"
						emptyMessage="No zones available"
						testId="forester-zone-picker"
						items={zonePickerItems()}
						onSelect={assignZone}
					/>
				</div>
			</PropertyGridRow>

			<StoredGoodsRow
				if={state.resolvedGame}
				content={props.content}
				game={state.resolvedGame!}
				label={state.isBuildSite ? T.construction.materials : T.goods.stored}
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
