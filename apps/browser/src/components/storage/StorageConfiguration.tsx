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

.config-preset-input {
	flex: 1;
	padding: 0.25rem 0.35rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	font-size: 0.78rem;
}

.config-preset-clear {
	width: 1.6rem;
	height: 1.6rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	border-radius: 999px;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text-muted);
	font-size: 1rem;
	line-height: 1;
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

let nextPresetListId = 0

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

function renameConfig(previousName: string, nextName: string): boolean {
	const existing = getConfig(previousName)
	if (!existing || !isConfigNameAvailable(nextName)) return false
	existing.name = nextName
	return true
}

function isConfigNameAvailable(name: string): boolean {
	if (name === SPECIFIC_PRESET) return false
	return !configRegistry.configs.some((c) => c.name === name)
}

export default function StorageConfiguration(props: StorageConfigurationProps) {
	const draft = reactive({
		bufferStars: {} as Partial<Record<GoodType, number>>,
		selectedPreset: SPECIFIC_PRESET,
		presetName: '',
	})
	const presetListId = `storage-config-presets-${nextPresetListId++}`

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
		const current = currentConfigSnapshot('')
		for (const config of configRegistry.configs) {
			if (config.storageMode !== current.storageMode) continue
			if (
				JSON.stringify([...config.storageExceptions].sort()) !==
				JSON.stringify([...current.storageExceptions].sort())
			)
				continue
			if (JSON.stringify(config.storageBuffers) !== JSON.stringify(current.storageBuffers)) continue
			if (
				isSpecific() &&
				JSON.stringify(config.specificBuffers) !== JSON.stringify(current.specificBuffers)
			)
				continue
			if (!isSpecific() && config.specificBuffers) continue
			return config.name
		}
		return SPECIFIC_PRESET
	}

	const currentConfigSnapshot = (name: string): NamedStorageConfig => {
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
			config.specificBuffers = (props.content.specificStorageConfiguration?.buffers ??
				{}) as Record<GoodType, number>
		}
		return config
	}

	const loadPreset = (name: string, config: NamedStorageConfig) => {
		props.content.storageMode = config.storageMode
		props.content.storageExceptions = [...config.storageExceptions]
		props.content.storageBuffers = { ...config.storageBuffers }
		if (isSpecific() && config.specificBuffers) {
			const storageConfig = props.content.specificStorageConfiguration
			if (storageConfig) {
				for (const [good, qty] of Object.entries(config.specificBuffers)) {
					storageConfig.buffers[good as GoodType] = qty
				}
			}
		}
		draft.selectedPreset = name
		draft.presetName = name
	}

	const loadPresetIfNamed = (value: string): boolean => {
		const name = value.trim()
		if (!name) return false
		const existingConfig = getConfig(name)
		if (!existingConfig) return false
		loadPreset(name, existingConfig)
		return true
	}

	const handlePresetInput = (value: string) => {
		draft.presetName = value
		loadPresetIfNamed(value)
	}

	const handlePresetSelection = () => {
		loadPresetIfNamed(draft.presetName)
	}

	const handlePresetCommit = () => {
		const name = draft.presetName.trim()
		if (!name) {
			clearPreset()
			return
		}
		if (loadPresetIfNamed(name)) return

		if (draft.selectedPreset !== SPECIFIC_PRESET) {
			if (renameConfig(draft.selectedPreset, name)) {
				draft.selectedPreset = name
				draft.presetName = name
			}
			return
		}

		saveConfig(name, currentConfigSnapshot(name))
		draft.selectedPreset = name
		draft.presetName = name
	}

	const clearPreset = () => {
		draft.selectedPreset = SPECIFIC_PRESET
		draft.presetName = ''
	}

	// Sync selected preset when settings change externally
	effect`storage-configuration:preset-sync`(() => {
		const matched = currentConfigName()
		if (draft.selectedPreset !== SPECIFIC_PRESET && matched !== draft.selectedPreset) {
			draft.selectedPreset = SPECIFIC_PRESET
			draft.presetName = ''
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
					<input
						class="config-preset-input"
						type="text"
						value={draft.presetName}
						update:value={handlePresetInput}
						onChange={handlePresetSelection}
						onBlur={handlePresetCommit}
						list={presetListId}
						placeholder={T.storage.configSpecific}
						data-testid="storage-config-preset-combobox"
					/>
					<datalist id={presetListId}>
						<for each={applicableConfigs()}>
							{(config) => <option value={config.name} />}
						</for>
					</datalist>
					<button
						if={draft.presetName}
						type="button"
						class="config-preset-clear"
						onClick={clearPreset}
						title={T.storage.configSpecific}
						data-testid="storage-config-clear-preset"
					>
						x
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
