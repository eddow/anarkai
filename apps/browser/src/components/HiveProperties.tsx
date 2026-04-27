import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { bumpSelectionTitleVersion } from '@app/lib/globals'
import { resolveHiveFromAnchorTile, type SyntheticHiveObject } from '@app/lib/hive-inspector'
import { getTranslator } from '@app/lib/i18n'
import { InspectorSection } from '@app/ui/anarkai'
import { goods as visualGoods } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import { queryConstructionSiteView } from 'ssh/construction'
import { collectDockedVehiclesForHive, type DockedVehicleEntry } from 'ssh/freight/docked-vehicles'
import { BuildAlveolus } from 'ssh/hive/build'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority } from 'ssh/utils/advertisement'
import { summarizeHiveGoodsRelations } from './alveolus-summary'
import ConstructionProgressBar from './ConstructionProgressBar'
import DockedVehicleList from './DockedVehicleList'
import EntityBadge from './EntityBadge'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import WorkingIndicator from './parts/WorkingIndicator'

css`
.hive-properties__ads {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.hive-properties__ad-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
	min-width: 0;
}

.hive-properties__meta {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	flex: none;
}

.hive-properties__count {
	font-size: 0.75rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: var(--ak-text-muted);
	min-width: 1.25rem;
	text-align: center;
}

.hive-properties__arrow {
	line-height: 1;
	font-weight: 800;
	user-select: none;
}

.hive-properties__arrow--demand {
	color: color-mix(in srgb, #b45309 85%, var(--ak-text));
}

.hive-properties__arrow--provide {
	color: color-mix(in srgb, #15803d 85%, var(--ak-text));
}

.hive-properties__arrow--w0 {
	font-size: 0.85rem;
	opacity: 0.55;
}

.hive-properties__arrow--w1 {
	font-size: 1rem;
	opacity: 0.78;
}

.hive-properties__arrow--w2 {
	font-size: 1.15rem;
	opacity: 1;
}

.hive-properties__empty {
	font-size: 0.875rem;
	color: var(--ak-text-muted);
}

.hive-properties__name {
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
}
`

const priorityTier = (priority: ExchangePriority): 0 | 1 | 2 => {
	const n = Number(priority[0])
	if (n === 0) return 0
	if (n === 1) return 1
	return 2
}

interface HivePropertiesProps {
	hiveObject: SyntheticHiveObject
}

interface HiveBuildSiteEntry {
	uid: string
	title: string
	phaseLabel: string
	blockingLabels: string[]
	workLine: string
	applied: number
	total: number
}

const HiveProperties = (props: HivePropertiesProps) => {
	const state = reactive({
		hiveName: '',
		working: true,
		entries: [] as ReturnType<typeof summarizeHiveGoodsRelations>,
		buildSites: [] as HiveBuildSiteEntry[],
		dockedVehicles: [] as DockedVehicleEntry[],
	})
	const currentHive = () =>
		resolveHiveFromAnchorTile(props.hiveObject.game, props.hiveObject.anchorTileUid)

	effect`hive-properties:ads`(() => {
		const hive = currentHive()
		if (!hive) {
			state.hiveName = ''
			state.working = false
			state.entries = []
			state.buildSites = []
			state.dockedVehicles = []
			return
		}
		state.hiveName = hive.name?.trim() ?? ''
		state.working = hive.working
		state.entries = summarizeHiveGoodsRelations(
			Array.from(hive.alveoli).map((alveolus) => ({
				name: alveolus.name,
				action: alveolus.action,
				target: alveolus instanceof BuildAlveolus ? alveolus.target : undefined,
				goodsRelations: alveolus.goodsRelations,
			}))
		)
		state.dockedVehicles = collectDockedVehiclesForHive(props.hiveObject.game, hive)
		const constructionTranslator = getTranslator() as ConstructionTranslatorShape
		state.buildSites = Array.from(hive.alveoli)
			.filter((alveolus): alveolus is BuildAlveolus => alveolus instanceof BuildAlveolus)
			.map((site) => {
				const snap = queryConstructionSiteView(props.hiveObject.game, site.tile)
				if (!snap) {
					return {
						uid: site.uid,
						title: site.target,
						phaseLabel: site.target,
						blockingLabels: [],
						workLine: '',
						applied: 0,
						total: 0,
					}
				}
				const model = buildConstructionViewModel(snap, constructionTranslator)
				return {
					uid: site.uid,
					title: alveolusLabel(site.target),
					phaseLabel: model.phaseLabel,
					blockingLabels: model.blockingLabels,
					workLine: model.workLine,
					applied: model.applied,
					total: model.total,
				}
			})
	})

	function goodSprite(goodType: string): string {
		const key = goodType as keyof typeof visualGoods
		return visualGoods[key]?.sprites?.[0] ?? visualGoods[key]?.icon ?? ''
	}

	function goodLabel(goodType: string): string {
		return String(getTranslator().goods[goodType as GoodType])
	}

	function alveolusLabel(alveolusType: string): string {
		return String(getTranslator().alveoli[alveolusType])
	}
	const handleNameInput = (value: string) => {
		const hive = currentHive()
		if (!hive) return
		const previousName = hive.name
		hive.name = value.trim() === '' ? undefined : value
		state.hiveName = hive.name ?? ''
		if ((previousName ?? '') !== (hive.name ?? '')) {
			bumpSelectionTitleVersion()
		}
	}

	const handleWorkingChange = (checked: boolean) => {
		const hive = currentHive()
		if (!hive) return
		hive.working = checked
		state.working = checked
	}

	return (
		<InspectorSection title={getTranslator().hive.section}>
			<PropertyGrid>
				<PropertyGridRow label={getTranslator().hive.name}>
					<input
						class="hive-properties__name"
						type="text"
						value={state.hiveName}
						onInput={(event) => handleNameInput((event.currentTarget as HTMLInputElement).value)}
					/>
				</PropertyGridRow>
				<PropertyGridRow label={getTranslator().hive.commands}>
					<WorkingIndicator
						checked={state.working}
						tooltip={getTranslator().hive.workingTooltip}
						onChange={handleWorkingChange}
					/>
				</PropertyGridRow>
				<PropertyGridRow if={state.entries.length === 0} label="">
					<span class="hive-properties__empty">{getTranslator().hive.noAds}</span>
				</PropertyGridRow>
				<PropertyGridRow if={state.entries.length > 0} label={getTranslator().hive.ads}>
					<div class="hive-properties__ads">
						<for each={state.entries}>
							{(entry) => {
								const tier = priorityTier(entry.priority as ExchangePriority)
								const arrowClass =
									entry.advertisement === 'demand'
										? 'hive-properties__arrow hive-properties__arrow--demand'
										: 'hive-properties__arrow hive-properties__arrow--provide'
								const weightClass = `hive-properties__arrow--w${tier}`
								const sprite = goodSprite(entry.goodType)
								const label = goodLabel(entry.goodType)
								const count = entry.types.length
								return (
									<div
										class="hive-properties__ad-row"
										data-testid={`hive-ad-row-${entry.goodType}-${entry.advertisement}`}
										title={label}
									>
										<EntityBadge
											game={props.hiveObject.game}
											sprite={sprite}
											text={label}
											height={22}
										/>
										<div class="hive-properties__meta">
											<span class="hive-properties__count" title={getTranslator().hive.sourcesHint}>
												{count}
											</span>
											<span
												class={[arrowClass, weightClass]}
												title={label}
												aria-label={
													entry.advertisement === 'demand'
														? getTranslator().hive.demand
														: getTranslator().hive.provide
												}
											>
												{entry.advertisement === 'demand' ? '↓' : '↑'}
											</span>
										</div>
									</div>
								)
							}}
						</for>
					</div>
				</PropertyGridRow>
				<PropertyGridRow
					if={state.dockedVehicles.length > 0}
					label={getTranslator().vehicle.docked}
				>
					<DockedVehicleList entries={state.dockedVehicles} showLineMeta />
				</PropertyGridRow>
				<PropertyGridRow
					if={state.buildSites.length > 0}
					label={getTranslator().construction.section}
				>
					<div class="hive-properties__ads">
						<for each={state.buildSites}>
							{(site) => (
								<div class="hive-properties__ad-row" data-testid={`hive-build-site-${site.uid}`}>
									<div style="display:grid; gap:0.4rem; width:100%;">
										<div class="hive-properties__ad-row">
											<strong>{site.title}</strong>
											<span>{site.phaseLabel}</span>
											<for each={site.blockingLabels}>
												{(label) => <span style="color: var(--ak-text-muted)"> · {label}</span>}
											</for>
										</div>
										<ConstructionProgressBar
											if={site.total > 0}
											applied={site.applied}
											total={site.total}
											label={site.workLine}
											testId={`hive-build-progress-${site.uid}`}
										/>
									</div>
								</div>
							)}
						</for>
					</div>
				</PropertyGridRow>
			</PropertyGrid>
		</InspectorSection>
	)
}

export default HiveProperties
