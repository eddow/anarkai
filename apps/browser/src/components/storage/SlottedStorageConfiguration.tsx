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
		get displayedGeneralSlots() {
			return Math.min(this.configuration?.generalSlots ?? 0, this.remainingBudget)
		},
		rule(goodType: GoodType) {
			return this.configuration?.goods[goodType] ?? { minSlots: 0, maxSlots: 0 }
		},
		specificGoodMaximum(goodType: GoodType) {
			const otherBufferedSlots = this.configuredGoods
				.filter((candidate) => candidate !== goodType)
				.reduce((total, candidate) => total + (this.rule(candidate).minSlots ?? 0), 0)
			return Math.max(0, this.totalSlots - otherBufferedSlots)
		},
	}

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
					<div class="slotted-storage-stars__row">
						<Stars
							maximum={view.remainingBudget}
							value={view.displayedGeneralSlots}
							onChange={(value: StarsValue) => {
								const nextGeneralSlots = Math.min(starsValue(value), view.remainingBudget)
								view.content?.setSlottedGeneralSlots(nextGeneralSlots)
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
						const maximum = view.specificGoodMaximum(goodType)
						const displayedRange: [number, number] = [
							Math.min(rule.minSlots, maximum),
							Math.min(rule.minSlots + rule.maxSlots, maximum),
						]
						const range = [
							view.rule(goodType).minSlots,
							view.rule(goodType).minSlots + view.rule(goodType).maxSlots,
						] as [number, number]
						const unavailableSlots = Math.max(0, view.totalSlots - maximum)
						return (
							<div class="slotted-storage-stars">
								<div class="slotted-storage-stars__row">
									<Stars
										maximum={maximum}
										value={range}
										onChange={(value: StarsValue) => {
											const [rawMinSlots, rawTotalSlots] = starsRangeValue(value, range)
											const nextMinSlots = Math.min(rawMinSlots, maximum)
											const nextTotalSlots = Math.min(rawTotalSlots, maximum)
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
									<for each={unavailableSlotElements(unavailableSlots)}>
										{() => <span class="slotted-storage-stars__unavailable">■</span>}
									</for>
								</div>
								<span class="slotted-storage-summary">
									buffer {displayedRange[0] * view.capacity}, total{' '}
									{displayedRange[1] * view.capacity} / {maximum * view.capacity}
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
