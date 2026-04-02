import { css } from '@app/lib/css'
import { effect, reactive } from 'mutts'
import type { Alveolus } from 'ssh/board/content/alveolus'
import type { Game } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { i18nState } from 'ssh/i18n'
import PropertyGridRow from './PropertyGridRow'
import WorkingIndicator from './parts/WorkingIndicator'
import StorageConfiguration from './storage/StorageConfiguration'
import StoredGoodsRow from './storage/StoredGoodsRow'

css`
.alveolus-commands {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}
.alveolus-hive-summary {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.75rem;
}
.alveolus-hive-summary-item {
	display: flex;
	gap: 0.35rem;
	align-items: baseline;
	flex-wrap: wrap;
	padding: 0.125rem 0;
}
.alveolus-hive-summary-types {
	opacity: 0.8;
}
`

interface AlveolusPropertiesProps {
	content: Alveolus
	game: Game
}

const AlveolusProperties = (props: AlveolusPropertiesProps) => {
	const state = reactive({
		working: false,
		isStorage: false,
		storageContent: undefined as StorageAlveolus | undefined,
	})

	effect`alveolus-properties:storage-check`(() => {
		const content = props.content
		state.isStorage = content instanceof StorageAlveolus
		state.storageContent = content instanceof StorageAlveolus ? content : undefined
		state.working = content?.working ?? false
	})

	const handleWorkingChange = (checked: boolean) => {
		if (!props.content) return
		props.content.working = checked
		state.working = checked
	}

	const hiveAdvertisementSummary = () => {
		const hive = props.content?.hive
		if (!hive) return []
		return Object.entries(hive.advertisements).map(([goodType, ad]) => {
			const advertisers = ad.advertisers
				.flat()
				.filter((alveolus) => !!alveolus && !!alveolus.action)
			const priorityIndex = advertisers.length
				? ad.advertisers.reduce((max, bucket, index) => (bucket.length ? index : max), 0)
				: 0
			return {
				goodType,
				advertisement: ad.advertisement,
				priority: (['0-store', '1-buffer', '2-use'] as const)[priorityIndex],
				types: advertisers.map((alveolus) => alveolus.action?.type).filter(Boolean),
			}
		})
	}
	const formatPriority = (priority: string) => {
		switch (priority) {
			case '0-store':
				return 'S'
			case '1-buffer':
				return 'B'
			case '2-use':
				return 'U'
			default:
				return priority
		}
	}

	return (
		<>
			<PropertyGridRow label={String(i18nState.translator?.alveolus.commands ?? '')}>
				<div class="alveolus-commands">
					<WorkingIndicator
						checked={state.working}
						tooltip={String(i18nState.translator?.alveolus.workingTooltip ?? '')}
						onChange={handleWorkingChange}
					/>
				</div>
			</PropertyGridRow>

			<PropertyGridRow if={props.content?.hive} label="Hive ads">
				<div class="alveolus-hive-summary">
					<for each={hiveAdvertisementSummary()}>
						{(entry) => (
							<div class="alveolus-hive-summary-item">
								<span>{entry.goodType}</span>
								<span>
									{entry.advertisement === 'demand' ? '↓' : '↑'}
									{formatPriority(entry.priority)}
								</span>
								<span class="alveolus-hive-summary-types">{entry.types.join(', ')}</span>
							</div>
						)}
					</for>
				</div>
			</PropertyGridRow>

			<StoredGoodsRow
				content={props.content}
				game={props.game}
				label={String(i18nState.translator?.goods.stored ?? '')}
			/>

			<StorageConfiguration
				if={state.isStorage}
				content={state.storageContent!}
				game={props.game}
			/>
		</>
	)
}

export default AlveolusProperties
