import { css } from '@app/lib/css'
import { Button, Stars } from '@app/ui/anarkai'
import type { StarsValue } from '@sursaut/ui/models'
import { goods as goodsCatalog } from 'engine-pixi/assets/visual-content'
import { effect, memoize, reactive } from 'mutts'
import type { Game } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { isRoadFretAction } from 'ssh/hive/storage-action'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType } from 'ssh/types/base'
import PropertyGridRow from '../PropertyGridRow'
import GoodMultiSelect from './GoodMultiSelect'
import SlottedStorageConfiguration from './SlottedStorageConfiguration'
import SpecificStorageConfiguration from './SpecificStorageConfiguration'

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

.buffer-stars-container {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 2px;
}

.buffer-quantity {
	font-size: 0.75rem;
	color: var(--ak-text-muted);
}
`

interface StorageConfigurationProps {
	content: StorageAlveolus
	game: Game
}

export default function StorageConfiguration(props: StorageConfigurationProps) {
	const draft = reactive({
		bufferStars: {} as Partial<Record<GoodType, number>>,
	})

	// Robust getters using memoize
	const mode = memoize(() => props.content.storageMode || 'all-but')
	const exceptions = memoize(() => props.content.storageExceptions || [])
	const buffers = memoize(() => props.content.storageBuffers || {})

	const allGoodTypes = Object.keys(goodsCatalog) as GoodType[]

	// --- Mode Logic ---
	const toggleMode = () => {
		props.content.storageMode = props.content.storageMode === 'all-but' ? 'only' : 'all-but'
	}

	const modeLabel = memoize(() => {
		return mode() === 'all-but' ? 'Store all but...' : 'Store only...'
	})

	// --- Exception Logic ---
	const availableExceptionCandidates = memoize(() => {
		const exc = exceptions()
		return allGoodTypes.filter((gt) => !exc.includes(gt))
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
	const isSlotted = memoize(() => props.content.storage instanceof SlottedStorage)
	const allowStorageEditors = memoize(() => {
		const action = props.content.action
		return action === undefined ? true : !isRoadFretAction(action)
	})

	const bufferedGoods = memoize(() => {
		return Object.keys(buffers()) as GoodType[]
	})

	const availableBufferCandidates = memoize(() => {
		const currentBufferKeys = Object.keys(buffers())
		let candidates: GoodType[] = []

		if (isSlotted()) {
			candidates = allGoodTypes
		} else if (props.content.storage instanceof SpecificStorage) {
			candidates = Object.keys(props.content.storage.maxAmounts) as GoodType[]
		}

		return candidates.filter((gt) => !currentBufferKeys.includes(gt))
	})

	const getBufferStars = (goodType: GoodType) => {
		const val = buffers()[goodType] || 0
		if (val <= 0) return 0
		if (isSlotted()) {
			// For SlottedStorage, val is number of slots.
			// 1 star = 1 slot. Max 5 stars.
			return Math.min(val, 5)
		} else {
			// For SpecificStorage, val is quantity.
			// 1 star = 20% of maxAmount.
			const max =
				props.content.storage instanceof SpecificStorage
					? props.content.storage.maxAmounts[goodType] || 0
					: 0
			if (max === 0) return 0
			// (val / max) * 5 => stars
			return Math.round((val / max) * 5)
		}
	}

	const setBufferFromStars = (goodType: GoodType, stars: number) => {
		let newVal = 0
		if (stars <= 0) {
			newVal = 0
		} else if (isSlotted()) {
			newVal = stars
		} else {
			const max =
				props.content.storage instanceof SpecificStorage
					? props.content.storage.maxAmounts[goodType] || 0
					: 0
			newVal = Math.round(max * (stars / 5))
		}

		const liveBuffers = props.content.storageBuffers ?? (props.content.storageBuffers = {})
		if (newVal <= 0) {
			delete liveBuffers[goodType]
		} else {
			liveBuffers[goodType] = newVal
		}
	}

	const getDisplayQuantity = (goodType: GoodType) => {
		const val = buffers()[goodType] || 0
		if (isSlotted()) {
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

	effect`storage-configuration:buffer-draft-sync`(() => {
		for (const goodType of bufferedGoods()) {
			draft.bufferStars[goodType] = getBufferStars(goodType)
		}
		const activeGoods = new Set(bufferedGoods())
		for (const goodType of Object.keys(draft.bufferStars) as GoodType[]) {
			if (!activeGoods.has(goodType)) {
				delete draft.bufferStars[goodType]
			}
		}
	})

	return (
		<div class="storage-config">
			<SlottedStorageConfiguration
				if={isSlotted() && allowStorageEditors()}
				content={props.content}
				game={props.game}
			/>

			{/* Non-slotted storage configuration */}
			<div if={!isSlotted() && allowStorageEditors()} style={{ display: 'contents' }}>
				{/* Acceptance Mode - Hide for SpecificStorage */}
				<PropertyGridRow
					label="Acceptance"
					if={!(props.content.storage instanceof SpecificStorage)}
				>
					<div class="mode-control">
						<Button onClick={toggleMode} el:class="mode-toggle">
							{modeLabel()}
						</Button>

						<GoodMultiSelect
							value={exceptions()}
							availableGoods={availableExceptionCandidates()}
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
					action={props.content.action as Ssh.SpecificStorageAction}
					configuration={props.content.specificStorageConfiguration}
					game={props.game}
				/>

				{/* Buffers - Non-SpecificStorage uses GoodMultiSelect */}
				<PropertyGridRow label="Buffers" if={!(props.content.storage instanceof SpecificStorage)}>
					<GoodMultiSelect
						value={bufferedGoods()}
						availableGoods={availableBufferCandidates()}
						game={props.game}
						addTitle="Add Buffer"
						onAdd={handleBufferAdd}
						onRemove={handleBufferRemove}
						renderItemExtra={(good) => (
							<div class="buffer-stars-container">
								<Stars
									value={draft.bufferStars[good] ?? getBufferStars(good)}
									maximum={5}
									onChange={(v: StarsValue) => {
										const nextStars = typeof v === 'number' ? v : v[1]
										draft.bufferStars[good] = nextStars
										setBufferFromStars(good, nextStars)
									}}
									size="1rem"
								/>
								<span class="buffer-quantity">{getDisplayQuantity(good)}</span>
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
