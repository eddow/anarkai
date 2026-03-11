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
`

interface AlveolusPropertiesProps {
	content: Alveolus
	game: Game
}

const AlveolusProperties = ({ content, game }: AlveolusPropertiesProps) => {
	const state = reactive({
		working: false,
		isStorage: false,
		storageContent: undefined as StorageAlveolus | undefined,
	})

	effect(() => {
		state.isStorage = content instanceof StorageAlveolus
		state.storageContent = content instanceof StorageAlveolus ? content : undefined
		state.working = content.working
	})

	const handleWorkingChange = (checked: boolean) => {
		content.working = checked
		state.working = checked
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

			<StoredGoodsRow
				content={content}
				game={game}
				label={String(i18nState.translator?.goods.stored ?? '')}
			/>

			<StorageConfiguration if={state.isStorage} content={state.storageContent!} game={game} />
		</>
	)
}

export default AlveolusProperties
