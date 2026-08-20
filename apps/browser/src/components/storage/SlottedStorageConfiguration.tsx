import { css } from '@app/lib/css'
import { Stars } from '@app/ui/anarkai'
import type { StarsValue } from '@sursaut/ui/models'
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
	// Derive directly from the reactive configuration instead of buffering into a
	// local `state` + `effect` sync (Sursaut "avoid redundant synchronization").
	const view = {
		get config() {
			return props.content?.slottedStorageConfiguration
		},
		get rule() {
			return this.config?.goods[props.goodType] ?? { minSlots: 0, maxSlots: 0 }
		},
		get otherBuffered() {
			return (Object.keys(this.config?.goods ?? {}) as GoodType[])
				.filter((c) => c !== props.goodType)
				.reduce((t, c) => t + (this.config?.goods[c]?.minSlots ?? 0), 0)
		},
		get maximum() {
			return Math.max(0, props.totalSlots - this.otherBuffered)
		},
		get range(): [number, number] {
			return [this.rule.minSlots, this.rule.minSlots + this.rule.maxSlots]
		},
		set range(value: StarsValue) {
			const [rawMinSlots, rawTotalSlots] = starsRangeValue(value, [
				this.rule.minSlots,
				this.rule.minSlots + this.rule.maxSlots,
			])
			const nextMinSlots = Math.min(rawMinSlots, this.maximum)
			const nextTotalSlots = Math.min(rawTotalSlots, this.maximum)
			props.content?.setSlottedGoodConfiguration(props.goodType, {
				minSlots: nextMinSlots,
				maxSlots: Math.max(0, nextTotalSlots - nextMinSlots),
			})
		},
		get displayedRange(): [number, number] {
			return [
				Math.min(this.rule.minSlots, this.maximum),
				Math.min(this.rule.minSlots + this.rule.maxSlots, this.maximum),
			]
		},
		get unavailableSlots() {
			return Math.max(0, props.totalSlots - this.maximum)
		},
	}

	return (
		<div class="slotted-storage-stars">
			<div class="slotted-storage-stars__row">
				<Stars
					maximum={view.maximum}
					value={view.range}
					onChange={(value: StarsValue) => {
						const [rawMinSlots, rawTotalSlots] = starsRangeValue(value, view.range)
						const nextMinSlots = Math.min(rawMinSlots, view.maximum)
						const nextTotalSlots = Math.min(rawTotalSlots, view.maximum)
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
				<for each={unavailableSlotElements(view.unavailableSlots)}>
					{() => <span class="slotted-storage-stars__unavailable">■</span>}
				</for>
			</div>
			<span class="slotted-storage-summary">
				buffer {view.displayedRange[0] * props.capacity}, total{' '}
				{view.displayedRange[1] * props.capacity} / {view.maximum * props.capacity}
			</span>
		</div>
	)
}

function GeneralStarsEditor(props: { content: StorageAlveolus }) {
	const view = {
		get storage() {
			return props.content?.storage
		},
		get totalSlots() {
			return this.storage instanceof SlottedStorage ? this.storage.slots.length : 0
		},
		get config() {
			return props.content?.slottedStorageConfiguration
		},
		get bufferedSlots() {
			return (Object.keys(this.config?.goods ?? {}) as GoodType[]).reduce(
				(total, goodType) => total + (this.config?.goods[goodType]?.minSlots ?? 0),
				0
			)
		},
		get remainingBudget() {
			return Math.max(0, this.totalSlots - this.bufferedSlots)
		},
		get displayedGeneralSlots() {
			return Math.min(this.config?.generalSlots ?? 0, this.remainingBudget)
		},
		set displayedGeneralSlots(value: StarsValue) {
			const nextGeneralSlots = Math.min(starsValue(value), this.remainingBudget)
			props.content?.setSlottedGeneralSlots(nextGeneralSlots)
		},
	}

	return (
		<div class="slotted-storage-stars">
			<div class="slotted-storage-stars__row">
				<Stars
					maximum={view.remainingBudget}
					value={view.displayedGeneralSlots}
					onChange={(value: StarsValue) => {
						const nextGeneralSlots = Math.min(starsValue(value), view.remainingBudget)
						props.content?.setSlottedGeneralSlots(nextGeneralSlots)
					}}
					size="1rem"
					zeroElement="□"
					before="■"
					after="■"
				/>
				<for each={unavailableSlotElements(view.bufferedSlots)}>
					{() => <span class="slotted-storage-stars__unavailable">■</span>}
				</for>
			</div>
			<span class="slotted-storage-summary">
				{view.displayedGeneralSlots} / {view.totalSlots} slots
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
