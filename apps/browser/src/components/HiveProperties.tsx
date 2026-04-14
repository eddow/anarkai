import { css } from '@app/lib/css'
import { bumpSelectionTitleVersion } from '@app/lib/globals'
import { InspectorSection } from '@app/ui/anarkai'
import { goods as visualGoods } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import { resolveHiveFromAnchorTile, type SyntheticHiveObject } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority } from 'ssh/utils/advertisement'
import { summarizeHiveGoodsRelations } from './alveolus-summary'
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

const HiveProperties = (props: HivePropertiesProps) => {
	const state = reactive({
		hiveName: '',
		working: true,
		entries: [] as ReturnType<typeof summarizeHiveGoodsRelations>,
	})
	const currentHive = () =>
		resolveHiveFromAnchorTile(props.hiveObject.game, props.hiveObject.anchorTileUid)

	effect`hive-properties:ads`(() => {
		const hive = currentHive()
		if (!hive) {
			state.hiveName = ''
			state.working = false
			state.entries = []
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
	})

	const goodSprite = (goodType: string): string => {
		const key = goodType as keyof typeof visualGoods
		return visualGoods[key]?.sprites?.[0] ?? visualGoods[key]?.icon ?? ''
	}

	const goodLabel = (goodType: string): string => {
		const t = i18nState.translator?.goods?.[goodType as GoodType]
		return typeof t === 'string' && t.length > 0 ? t : goodType
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
		<InspectorSection title={i18nState.translator?.hive?.section ?? 'Hive'}>
			<PropertyGrid>
				<PropertyGridRow label={i18nState.translator?.hive?.name ?? 'Name'}>
					<input
						class="hive-properties__name"
						type="text"
						value={state.hiveName}
						onInput={(event) => handleNameInput((event.currentTarget as HTMLInputElement).value)}
					/>
				</PropertyGridRow>
				<PropertyGridRow label={i18nState.translator?.hive?.commands ?? 'Commands'}>
					<WorkingIndicator
						checked={state.working}
						tooltip={i18nState.translator?.hive?.workingTooltip ?? 'Toggle hive activity'}
						onChange={handleWorkingChange}
					/>
				</PropertyGridRow>
				<PropertyGridRow if={state.entries.length === 0} label="">
					<span class="hive-properties__empty">
						{i18nState.translator?.hive?.noAds ?? 'No hive advertisements on this anchor.'}
					</span>
				</PropertyGridRow>
				<PropertyGridRow
					if={state.entries.length > 0}
					label={i18nState.translator?.hive?.ads ?? 'Ads'}
				>
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
											<span
												class="hive-properties__count"
												title={i18nState.translator?.hive?.sourcesHint ?? 'Sources'}
											>
												{count}
											</span>
											<span
												class={[arrowClass, weightClass]}
												title={label}
												aria-label={
													entry.advertisement === 'demand'
														? (i18nState.translator?.hive?.demand ?? 'Demand')
														: (i18nState.translator?.hive?.provide ?? 'Provide')
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
			</PropertyGrid>
		</InspectorSection>
	)
}

export default HiveProperties
