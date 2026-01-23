import { derived } from 'mutts'
import type { StorageAlveolus } from 'ssh/src/lib/hive/storage'
import type { GoodType } from 'ssh/src/lib/types/base'
import { goods as goodsCatalog } from 'engine-pixi/assets/visual-content'
import PropertyGridRow from '../PropertyGridRow'
import { Button, Stars } from 'pounce-ui/src'
import GoodMultiSelect from './GoodMultiSelect'
import { SlottedStorage } from 'ssh/src/lib/storage/slotted-storage'
import { SpecificStorage } from 'ssh/src/lib/storage/specific-storage'
import { css } from '@app/lib/css'
import SpecificStorageConfiguration from './SpecificStorageConfiguration'
import type { Game } from 'ssh/src/lib/game'

css`
.storage-config {
	display: contents;
}

.slotted-todo {
	padding: 1rem;
	margin-top: 1rem;
	border: 1px dashed var(--pico-muted-border-color);
	border-radius: 4px;
	color: var(--pico-muted-color);
	font-style: italic;
	text-align: center;
}

.mode-control {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.mode-toggle {
	align-self: flex-start;
	white-space: nowrap;
}

.buffer-stars-container {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 2px;
}

.buffer-quantity {
	font-size: 0.75rem;
	color: var(--pico-muted-color);
}
`

interface StorageConfigurationProps {
	content: StorageAlveolus
	game: Game
}

export default function StorageConfiguration(props: StorageConfigurationProps) {
	// Robust getters using derived
	const mode = derived(() => props.content.storageMode || 'all-but')
	const exceptions = derived(() => props.content.storageExceptions || [])
	const buffers = derived(() => props.content.storageBuffers || {})

	const allGoodTypes = Object.keys(goodsCatalog) as GoodType[]

	// --- Mode Logic ---
	const toggleMode = () => {
		props.content.storageMode = props.content.storageMode === 'all-but' ? 'only' : 'all-but'
	}

	const modeLabel = derived(() => {
		return mode.value === 'all-but' ? 'Store all but...' : 'Store only...'
	})

	// --- Exception Logic ---
	const availableExceptionCandidates = derived(() => {
		const exc = exceptions.value
		return allGoodTypes.filter(gt => !exc.includes(gt))
	})

	const addException = (good: GoodType) => {
		if (!props.content.storageExceptions) {
			props.content.storageExceptions = []
		}
		props.content.storageExceptions.push(good)
	}

	const removeException = (good: GoodType) => {
		const idx = props.content.storageExceptions.indexOf(good)
		if (idx !== -1) {
			props.content.storageExceptions.splice(idx, 1)
		}
	}

	// --- Buffer Logic ---
	const isSlotted = derived(() => props.content.storage instanceof SlottedStorage)

	const bufferedGoods = derived(() => {
		return Object.keys(buffers.value) as GoodType[]
	})

	const availableBufferCandidates = derived(() => {
		const currentBufferKeys = Object.keys(buffers.value)
		let candidates: GoodType[] = []

		if (isSlotted.value) {
			candidates = allGoodTypes
		} else if (props.content.storage instanceof SpecificStorage) {
			candidates = Object.keys(props.content.storage.maxAmounts) as GoodType[]
		}

		return candidates.filter(gt => !currentBufferKeys.includes(gt))
	})

	const getBufferStars = (goodType: GoodType) => {
		const val = buffers.value[goodType] || 0
		if (val <= 0) return 0
		if (isSlotted.value) {
			// For SlottedStorage, val is number of slots.
			// 1 star = 1 slot. Max 5 stars.
			return Math.min(val, 5)
		} else {
			// For SpecificStorage, val is quantity.
			// 1 star = 20% of maxAmount.
			const max = props.content.storage instanceof SpecificStorage ? (props.content.storage.maxAmounts[goodType] || 0) : 0
			if (max === 0) return 0
			// (val / max) * 5 => stars
			return Math.round((val / max) * 5)
		}
	}

	const setBufferFromStars = (goodType: GoodType, stars: number) => {
		let newVal = 0
		if (stars <= 0) {
			newVal = 0
		} else if (isSlotted.value) {
			newVal = stars
		} else {
			const max = props.content.storage instanceof SpecificStorage ? (props.content.storage.maxAmounts[goodType] || 0) : 0
			newVal = Math.round(max * (stars / 5))
		}

		const newBuffers = { ...props.content.storageBuffers }
		if (newVal <= 0) {
			delete newBuffers[goodType]
		} else {
			newBuffers[goodType] = newVal
		}
		props.content.storageBuffers = newBuffers
	}

	const getDisplayQuantity = (goodType: GoodType) => {
		const val = buffers.value[goodType] || 0
		if (isSlotted.value) {
			return val * (props.content.storage as SlottedStorage).maxQuantityPerSlot
		}
		return val
	}

	const handleBufferAdd = (gt: GoodType) => {
		// Default to 1 star
		setBufferFromStars(gt, 1)
	}

	const handleBufferRemove = (gt: GoodType) => {
		setBufferFromStars(gt, 0)
	}

	return (
		<div class="storage-config">
			{/* Slotted Storage: TODO placeholder */}
			<div class="slotted-todo" if={isSlotted.value}>
				TODO: Slotted Storage Configuration
			</div>

			{/* Non-slotted storage configuration */}
			<div if={!isSlotted.value} style={{ display: 'contents' }}>
				{/* Acceptance Mode - Hide for SpecificStorage */}
				<PropertyGridRow label="Acceptance" if={!(props.content.storage instanceof SpecificStorage)}>
					<div class="mode-control">
						<Button onClick={toggleMode} el={{ class: 'mode-toggle' }}>
							{modeLabel.value}
						</Button>

						<GoodMultiSelect
							value={exceptions.value}
							availableGoods={availableExceptionCandidates.value}
							game={props.game}
							addTitle="Add Exception"
							onAdd={addException}
							onRemove={removeException}
						>
							No exceptions
						</GoodMultiSelect>
					</div>
				</PropertyGridRow>

				{/* Buffers - SpecificStorage uses its own component */}
				<SpecificStorageConfiguration
					if={props.content.storage instanceof SpecificStorage}
					action={(props.content.action as Ssh.SpecificStorageAction)}
					configuration={props.content.storageConfiguration}
					game={props.game}
				/>

				{/* Buffers - Non-SpecificStorage uses GoodMultiSelect */}
				<PropertyGridRow label="Buffers" if={!(props.content.storage instanceof SpecificStorage)}>
					<GoodMultiSelect
						value={bufferedGoods.value}
						availableGoods={availableBufferCandidates.value}
						game={props.game}
						addTitle="Add Buffer"
						addLabel="Add Buffer"
						onAdd={handleBufferAdd}
						onRemove={handleBufferRemove}
						renderItemExtra={(good) => (
							<div class="buffer-stars-container">
								<Stars
									value={getBufferStars(good)}
									maximum={5}
									onChange={(v: number | [number, number]) => setBufferFromStars(good, typeof v === 'number' ? v : v[1])}
									size="1rem"
								/>
								<span class="buffer-quantity">
									{getDisplayQuantity(good)}
								</span>
							</div>
						)}
					>
						No active buffers
					</GoodMultiSelect>
				</PropertyGridRow>
			</div>
		</div>
	)
}
