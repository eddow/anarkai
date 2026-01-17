import { derived } from 'mutts'
import type { StorageAlveolus } from '@ssh/lib/game/hive/storage'
import type { GoodType } from '@ssh/lib/types/base'
import { goods as goodsCatalog } from 'engine-pixi/assets/visual-content'
import PropertyGridRow from '../PropertyGridRow'
import { Button } from 'pounce-ui/src'
import GoodMultiSelect from './GoodMultiSelect'
import { SlottedStorage } from '@ssh/lib/game/storage/slotted-storage'
import { SpecificStorage } from '@ssh/lib/game/storage/specific-storage'
import { css } from '@app/lib/css'
import type { Game } from '@ssh/lib/game'

css`
.storage-config {
	display: contents;
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

.buffer-input {
	width: 60px;
	padding: 2px 4px;
	font-size: 0.8rem;
	height: 24px;
	text-align: right;
	border: 1px solid var(--pico-muted-border-color);
	border-radius: 4px;
	background: var(--pico-background-color);
	color: var(--pico-color);
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

	const getBufferValue = (goodType: GoodType) => {
		const val = buffers.value[goodType] || 0
		if (isSlotted.value) {
			return val * (props.content.storage as SlottedStorage).maxQuantityPerSlot
		}
		return val
	}

	const setBufferValue = (goodType: GoodType, pieces: number) => {
		const newBuffers = { ...props.content.storageBuffers }
		if (pieces <= 0) {
			delete newBuffers[goodType]
		} else {
			if (isSlotted.value) {
				newBuffers[goodType] = Math.ceil(pieces / (props.content.storage as SlottedStorage).maxQuantityPerSlot)
			} else {
				newBuffers[goodType] = pieces;
			}
		}
		props.content.storageBuffers = newBuffers
	}

	const handleBufferAdd = (gt: GoodType) => {
		setBufferValue(gt, isSlotted.value ? (props.content.storage as SlottedStorage).maxQuantityPerSlot : 1)
	}

	const handleBufferRemove = (gt: GoodType) => {
		setBufferValue(gt, 0)
	}

	return (
		<div class="storage-config">
			{/* Acceptance Mode */}
			<PropertyGridRow label="Acceptance">
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

			{/* Buffers */}
			<PropertyGridRow label="Buffers">
				<GoodMultiSelect
					value={bufferedGoods.value}
					availableGoods={availableBufferCandidates.value}
					game={props.game}
					addTitle="Add Buffer"
					addLabel="Add Buffer"
					onAdd={handleBufferAdd}
					onRemove={handleBufferRemove}
					renderItemExtra={(good) => (
						<input
							type="number"
							value={getBufferValue(good)}
							onInput={(e: Event) => setBufferValue(good, parseInt((e.target as HTMLInputElement).value) || 0)}
							min={0}
							class="buffer-input"
						/>
					)}
				>
					No active buffers
				</GoodMultiSelect>
			</PropertyGridRow>
		</div>
	)
}
