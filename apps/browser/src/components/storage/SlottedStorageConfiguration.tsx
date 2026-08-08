import { css } from '@app/lib/css'
import { Stars } from '@app/ui/anarkai'
import type { StarsValue } from '@sursaut/ui/models'
import { effect, reactive } from 'mutts'
import { goods as goodsCatalog } from 'engine-pixi/assets/visual-content'
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

.slotted-storage-stars__row {
	display: inline-flex;
	align-items: center;
	gap: 0.15rem;
}

.slotted-storage-stars__unavailable {
	color: color-mix(in srgb, var(--ak-danger, #c44) 72%, var(--ak-text-muted));
	opacity: 0.8;
	font-size: 1rem;
	line-height: 1;
	user-select: none;
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

function unavailableSlotElements(count: number) {
	return Array.from({ length: Math.max(0, count) })
}

function GoodStarsEditor(props: {
	content: StorageAlveolus
	goodType: GoodType
	capacity: number
	totalSlots: number
}) {
	const state = reactive({
		rule: { minSlots: 0, maxSlots: 0 },
		maximum: 0,
		range: [0, 0] as [number, number],
		displayedRange: [0, 0] as [number, number],
		unavailableSlots: 0,
	})
	effect`good-stars-sync`(() => {
		const config = props.content?.slottedStorageConfiguration
		const rule = config?.goods[props.goodType] ?? { minSlots: 0, maxSlots: 0 }
		const otherBuffered = (Object.keys(config?.goods ?? {}) as GoodType[])
			.filter((c) => c !== props.goodType)
			.reduce((t, c) => t + (config?.goods[c]?.minSlots ?? 0), 0)
		state.rule = { minSlots: rule.minSlots, maxSlots: rule.maxSlots }
		state.maximum = Math.max(0, props.totalSlots - otherBuffered)
		state.range = [state.rule.minSlots, state.rule.minSlots + state.rule.maxSlots]
		state.displayedRange = [
			Math.min(state.rule.minSlots, state.maximum),
			Math.min(state.rule.minSlots + state.rule.maxSlots, state.maximum),
		]
		state.unavailableSlots = Math.max(0, props.totalSlots - state.maximum)
	})

	return (
		<div class="slotted-storage-stars">
			<div class="slotted-storage-stars__row">
				<Stars
					maximum={state.maximum}
					value={state.range}
					onChange={(value: StarsValue) => {
						const [rawMinSlots, rawTotalSlots] = starsRangeValue(value, state.range)
						const nextMinSlots = Math.min(rawMinSlots, state.maximum)
						const nextTotalSlots = Math.min(rawTotalSlots, state.maximum)
						props.content?.setSlottedGoodConfiguration(props.goodType, {
							minSlots: nextMinSlots,
							maxSlots: Math.max(0, nextTotalSlots - nextMinSlots),
						})
					}}
					size="1rem"
					zeroElement="□"
					before="■"
					after="■"
				/>
				<for each={unavailableSlotElements(state.unavailableSlots)}>
					{() => <span class="slotted-storage-stars__unavailable">■</span>}
				</for>
			</div>
			<span class="slotted-storage-summary">
				buffer {state.displayedRange[0] * props.capacity}, total{' '}
				{state.displayedRange[1] * props.capacity} / {state.maximum * props.capacity}
			</span>
		</div>
	)
}

function GeneralStarsEditor(props: {
	content: StorageAlveolus
}) {
	const state = reactive({
		remainingBudget: 0,
		displayedGeneralSlots: 0,
		bufferedSlots: 0,
		totalSlots: 0,
	})
	effect`general-stars-sync`(() => {
		const storage = props.content?.storage
		if (!(storage instanceof SlottedStorage)) return
		const config = props.content?.slottedStorageConfiguration
		state.totalSlots = storage.slots.length
		const buffered = (Object.keys(config?.goods ?? {}) as GoodType[]).reduce(
			(total, goodType) => total + (config?.goods[goodType]?.minSlots ?? 0),
			0
		)
		const remaining = Math.max(0, state.totalSlots - buffered)
		state.bufferedSlots = buffered
		state.remainingBudget = remaining
		state.displayedGeneralSlots = Math.min(config?.generalSlots ?? 0, remaining)
	})

	return (
		<div class="slotted-storage-stars">
			<div class="slotted-storage-stars__row">
				<Stars
					maximum={state.remainingBudget}
					value={state.displayedGeneralSlots}
					onChange={(value: StarsValue) => {
						const nextGeneralSlots = Math.min(starsValue(value), state.remainingBudget)
						props.content?.setSlottedGeneralSlots(nextGeneralSlots)
					}}
					size="1rem"
					zeroElement="□"
					before="■"
					after="■"
				/>
				<for each={unavailableSlotElements(state.bufferedSlots)}>
					{() => <span class="slotted-storage-stars__unavailable">■</span>}
				</for>
			</div>
			<span class="slotted-storage-summary">
				{state.displayedGeneralSlots} / {state.totalSlots} slots
			</span>
		</div>
	)
}

export default function SlottedStorageConfiguration(props: SlottedStorageConfigurationProps) {
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
	}

	const addGood = (goodType: GoodType) => {
		view.content?.setSlottedGoodConfiguration(goodType, {
			minSlots: 0,
			maxSlots: 1,
		})
	}

	const removeGood = (goodType: GoodType) => {
		view.content?.removeSlottedGoodConfiguration(goodType)
	}

	return (
		<div if={view.isSlotted} class="slotted-storage-config">
			<PropertyGridRow label="General goods">
				<GeneralStarsEditor content={view.content} />
			</PropertyGridRow>

			<PropertyGridRow label="Specific goods">
				<GoodMultiSelect
					value={view.configuredGoods}
					availableGoods={view.availableGoods}
					game={props.game}
					addTitle="Add specific good"
					onAdd={addGood}
					onRemove={removeGood}
					renderItemExtra={(goodType) => (
						<GoodStarsEditor
							content={view.content}
							goodType={goodType}
							capacity={view.capacity}
							totalSlots={view.totalSlots}
						/>
					)}
				>
					No specific slot rules
				</GoodMultiSelect>
			</PropertyGridRow>
		</div>
	)
}
