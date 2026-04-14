import { css } from '@app/lib/css'
import { Stars } from '@app/ui/anarkai'
import type { StarsValue } from '@sursaut/ui/models'
import { goods as goodsCatalog } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import type { Game } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import type { GoodType } from 'ssh/types/base'
import PropertyGridRow from '../PropertyGridRow'
import GoodMultiSelect from './GoodMultiSelect'

css`
.slotted-storage-config {
	display: contents;
}

.slotted-storage-stars {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 0.35rem;
}

.slotted-storage-summary {
	font-size: 0.75rem;
	color: var(--ak-text-muted);
	text-align: right;
}
`

interface SlottedStorageConfigurationProps {
	content: StorageAlveolus
	game: Game
}

function starsValue(value: StarsValue): number {
	return typeof value === 'number' ? value : value[1]
}

function starsRangeValue(value: StarsValue, fallback: [number, number]): [number, number] {
	if (Array.isArray(value)) return [value[0], value[1]]
	return [fallback[0], typeof value === 'number' ? value : fallback[1]]
}

export default function SlottedStorageConfiguration(props: SlottedStorageConfigurationProps) {
	const draft = reactive({
		generalSlots: 0,
		ranges: {} as Partial<Record<GoodType, [number, number]>>,
	})

	const view = {
		get content() {
			return props.content
		},
		get storage() {
			return this.content?.storage
		},
		get isSlotted() {
			return this.storage instanceof SlottedStorage
		},
		get capacity() {
			return this.storage instanceof SlottedStorage ? this.storage.maxQuantityPerSlot : 1
		},
		get configuration() {
			return this.isSlotted ? this.content?.slottedStorageConfiguration : undefined
		},
		get totalSlots() {
			return this.storage instanceof SlottedStorage ? this.storage.slots.length : 0
		},
		get configuredGoods() {
			const config = this.configuration
			return config ? (Object.keys(config.goods) as GoodType[]) : []
		},
		get availableGoods() {
			const selected = new Set(this.configuredGoods)
			return (Object.keys(goodsCatalog) as GoodType[]).filter((goodType) => !selected.has(goodType))
		},
		get bufferedSlots() {
			const config = this.configuration
			if (!config) return 0
			return this.configuredGoods.reduce(
				(total, goodType) => total + (config.goods[goodType]?.minSlots ?? 0),
				0
			)
		},
		get remainingBudget() {
			return Math.max(0, this.totalSlots - this.bufferedSlots)
		},
		rule(goodType: GoodType) {
			return this.configuration?.goods[goodType] ?? { minSlots: 0, maxSlots: 0 }
		},
	}

	effect`slotted-storage-configuration:draft-sync`(() => {
		const configuration = view.configuration
		draft.generalSlots = configuration?.generalSlots ?? 0

		const activeGoods = new Set(view.configuredGoods)
		for (const goodType of view.configuredGoods) {
			const rule = view.rule(goodType)
			draft.ranges[goodType] = [rule.minSlots, rule.minSlots + rule.maxSlots]
		}
		for (const goodType of Object.keys(draft.ranges) as GoodType[]) {
			if (!activeGoods.has(goodType)) {
				delete draft.ranges[goodType]
			}
		}
	})

	const addGood = (goodType: GoodType) => {
		view.content?.setSlottedGoodConfiguration(goodType, {
			minSlots: 0,
			maxSlots: Math.min(1, view.remainingBudget),
		})
	}

	const removeGood = (goodType: GoodType) => {
		view.content?.removeSlottedGoodConfiguration(goodType)
	}

	return (
		<div if={view.isSlotted} class="slotted-storage-config">
			<PropertyGridRow label="General goods">
				<div class="slotted-storage-stars">
					<Stars
						maximum={view.remainingBudget}
						value={draft.generalSlots}
						onChange={(value: StarsValue) => {
							const nextGeneralSlots = starsValue(value)
							draft.generalSlots = nextGeneralSlots
							view.content?.setSlottedGeneralSlots(nextGeneralSlots)
						}}
						size="1rem"
						zeroElement="□"
						before="■"
						after="■"
					/>
					<span class="slotted-storage-summary">
						{view.configuration?.generalSlots ?? 0} / {view.remainingBudget} slots
					</span>
				</div>
			</PropertyGridRow>

			<PropertyGridRow label="Specific goods">
				<GoodMultiSelect
					value={view.configuredGoods}
					availableGoods={view.availableGoods}
					game={props.game}
					addTitle="Add specific good"
					onAdd={addGood}
					onRemove={removeGood}
					renderItemExtra={(goodType) => {
						const rule = view.rule(goodType)
						const displayedRange: [number, number] = [rule.minSlots, rule.minSlots + rule.maxSlots]
						const range = draft.ranges[goodType] ?? displayedRange
						return (
							<div class="slotted-storage-stars">
								<Stars
									maximum={view.totalSlots}
									value={range}
									onChange={(value: StarsValue) => {
										const [nextMinSlots, nextTotalSlots] = starsRangeValue(value, range)
										draft.ranges[goodType] = [nextMinSlots, nextTotalSlots]
										view.content?.setSlottedGoodConfiguration(goodType, {
											minSlots: nextMinSlots,
											maxSlots: Math.max(0, nextTotalSlots - nextMinSlots),
										})
									}}
									size="1rem"
									zeroElement="□"
									before="■"
									after="■"
								/>
								<span class="slotted-storage-summary">
									buffer {displayedRange[0] * view.capacity}, total{' '}
									{displayedRange[1] * view.capacity}
								</span>
							</div>
						)
					}}
				>
					No specific slot rules
				</GoodMultiSelect>
			</PropertyGridRow>
		</div>
	)
}
