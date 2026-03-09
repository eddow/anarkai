import { effect, reactive } from 'mutts'
import { css } from '@app/lib/css'
import WorkingIndicator from './parts/WorkingIndicator'
import PropertyGridRow from './PropertyGridRow'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { T } from 'ssh/i18n'
import { StorageAlveolus } from 'ssh/hive/storage'
import StorageConfiguration from './storage/StorageConfiguration'
import StoredGoodsRow from './storage/StoredGoodsRow'
import type { Game } from 'ssh/game'

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
		working: content.working,
	})

	let storageConfiguration: JSX.Element | undefined
	if (content instanceof StorageAlveolus) {
		storageConfiguration = <StorageConfiguration content={content} game={game} />
	}

	effect(() => {
		state.working = content.working
	})

	const handleWorkingChange = (checked: boolean) => {
		content.working = checked
		state.working = checked
	}

	return (
		<>
			<PropertyGridRow label={String(T.alveolus.commands)}>
				<div class="alveolus-commands">
					<WorkingIndicator
						checked={state.working}
						tooltip={String(T.alveolus.workingTooltip)}
						onChange={handleWorkingChange}
					/>
				</div>
			</PropertyGridRow>

			<StoredGoodsRow content={content} game={game} label={String(T.goods.stored)} />

			{storageConfiguration}
		</>
	)
}

export default AlveolusProperties
