import { effect, reactive } from 'mutts'
import { css } from '@app/lib/css'
import AlveolusFlag from './AlveolusFlag'
import PropertyGridRow from './PropertyGridRow'
import type { Alveolus } from '@ssh/lib/game/board/content/alveolus'
import { T } from '@ssh/lib/i18n'
import { StorageAlveolus } from '@ssh/lib/game/hive/storage'
import StorageConfiguration from './storage/StorageConfiguration'
import StoredGoodsRow from './storage/StoredGoodsRow'
import type { Game } from '@ssh/lib/game'

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
					<AlveolusFlag
						checked={state.working}
						icon="mdi:cog"
						name={String(T.alveolus.working)}
						tooltip={String(T.alveolus.workingTooltip)}
						onChange={handleWorkingChange}
					/>
				</div>
			</PropertyGridRow>

			<StoredGoodsRow content={content} game={game} label={String(T.goods.stored)} />

			{content instanceof StorageAlveolus && (
				<StorageConfiguration content={content} game={game} />
			)}
		</>
	)
}

export default AlveolusProperties
