import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
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

.config-preset-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.config-preset-select {
	flex: 1;
	padding: 0.25rem 0.35rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	font-size: 0.78rem;
}
`

interface StorageConfigurationProps {
	content: StorageAlveolus
	game: Game
}

interface NamedStorageConfig {
	name: string
	storageMode: 'all-but' | 'only'
	storageExceptions: GoodType[]
	storageBuffers: Record<GoodType, number>
	specificBuffers?: Record<GoodType, number>
}

const SPECIFIC_PRESET = '__specific__'

const configRegistry = reactive({
	configs: [] as NamedStorageConfig[],
})

function getConfig(name: string): NamedStorageConfig | undefined {
	return configRegistry.configs.find((c) => c.name === name)
}

function saveConfig(name: string, config: NamedStorageConfig): void {
	const existing = getConfig(name)
	if (existing) {
		Object.assign(existing, config)
	} else {
		configRegistry.configs.push({ ...config, name })
	}
}

function isConfigNameAvailable(name: string): boolean {
	if (name === SPECIFIC_PRESET) return false
	return !configRegistry.configs.some((c) => c.name === name)
}

export default function StorageConfiguration(props: StorageConfigurationProps) {
	const draft = reactive({
		bufferStars: {} as Partial<Record<GoodType, number>>,
		selectedPreset: SPECIFIC_PRESET,
		presetNameInput: '',
	})

	// Robust getters using memoize
	const mode = memoize(() => props.content.storageMode || 'all-but')
	const exceptions = memoize(() => props.content.storageExceptions || [])
	const buffers = memoize(() => props.content.storageBuffers || {})

	const allGoodTypes = Object.keys(goodsCatalog) as GoodType[]
	const isSlotted = memoize(() => props.content.storage instanceof SlottedStorage)
	const isSpecific = memoize(() => props.content.storage instanceof SpecificStorage)

	// --- Config Preset Logic ---
	const applicableConfigs = memoize((): NamedStorageConfig[] => {
		if (isSlotted()) {
			return configRegistry.configs.filter((c) => !c.specificBuffers)
		}
		return configRegistry.configs
	})

	const currentConfigName = () => {
		// Check if current settings match any saved config
		const current: NamedStorageConfig = {
			name: '',
			storageMode: mode(),
			storageExceptions: [...exceptions()],
			storageBuffers: {} as Record<GoodType, number>,
		}
		for (const [good, qty] of Object.entries(buffers())) {
			if (qty !== undefined && qty !== null) {
				current.storageBuffers[good as GoodType] = qty
			}
		}
		if (isSpecific()) {
			current.specificBuffers = (props.content.specificStorageConfiguration?.buffers ?? {}) as Record<GoodType, number>
		}
		for (const config of configRegistry.configs) {
			if (config.storageMode !== current.storageMode) continue
			if (JSON.stringify(config.storageExceptions.sort()) !== JSON.stringify(current.storageExceptions.sort())) continue
			if (JSON.stringify(config.storageBuffers) !== JSON.stringify(current.storageBuffers)) continue
			if (isSpecific() && JSON.stringify(config.specificBuffers) !== JSON.stringify(current.specificBuffers)) continue
			if (!isSpecific() && config.specificBuffers) continue
			return config.name
		}
		return SPECIFIC_PRESET
	}

	const handlePresetChange = (value: string) => {
		if (value === SPECIFIC_PRESET) {
			draft.selectedPreset = SPECIFIC_PRESET
			return
		}
		const config = getConfig(value)
		if (!config) {
			// New config name entered
			draft.presetNameInput = value
			draft.selectedPreset = SPECIFIC_PRESET
			return
		}
		// Load config
		props.content.storageMode = config.storageMode
		props.content.storageExceptions = [...config.storageExceptions]
		props.content.storageBuffers = { ...config.storageBuffers }
		if (isSpecific() && config.specificBuffers) {
			const existingConfig = props.content.specificStorageConfiguration
			if (existingConfig) {
				// Mutate the buffers property
				for (const [good, qty] of Object.entries(config.specificBuffers)) {
					existingConfig.buffers[good as GoodType] = qty
				}
			}
		}
		draft.selectedPreset = value
	}

	const handleSaveConfig = () => {
		const name = draft.presetNameInput.trim()
		if (!name || !isConfigNameAvailable(name)) return
		const config: NamedStorageConfig = {
			name,
			storageMode: mode(),
			storageExceptions: [...exceptions()],
			storageBuffers: {} as Record<GoodType, number>,
		}
		for (const [good, qty] of Object.entries(buffers())) {
			if (qty !== undefined && qty !== null) {
				config.storageBuffers[good as GoodType] = qty
			}
		}
		if (isSpecific()) {
			config.specificBuffers = (props.content.specificStorageConfiguration?.buffers ?? {}) as Record<GoodType, number>
		}
		saveConfig(name, config)
		draft.selectedPreset = name
		draft.presetNameInput = ''
	}

	// Sync selected preset when settings change externally
	effect`storage-configuration:preset-sync`(() => {
		const matched = currentConfigName()
		if (matched !== draft.selectedPreset) {
			draft.selectedPreset = matched
		}
	})

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
			{/* Config Preset Row */}
			<PropertyGridRow if={allowStorageEditors()} label={T.storage.configPreset}>
				<div class="config-preset-row">
					<select
						class="config-preset-select"
						value={draft.selectedPreset}
						update:value={handlePresetChange}
						data-testid="storage-config-preset-select"
					>
						<option value={SPECIFIC_PRESET}>{T.storage.configSpecific}</option>
						<for each={applicableConfigs()}>
							{(config) => <option value={config.name}>{config.name}</option>}
						</for>
					</select>
					<button
						if={draft.presetNameInput && isConfigNameAvailable(draft.presetNameInput)}
						type="button"
						onClick={handleSaveConfig}
						title={T.storage.configCreateLabel.replace('{name}', draft.presetNameInput)}
						data-testid="storage-config-save-preset"
					>
						+
					</button>
				</div>
			</PropertyGridRow>

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
