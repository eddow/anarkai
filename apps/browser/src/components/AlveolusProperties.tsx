import { css } from '@app/lib/css'
import { effect, reactive } from 'mutts'
import type { Alveolus } from 'ssh/board/content/alveolus'
import {
	createSyntheticFreightLineObject,
	findFreightLinesForStop,
	type SyntheticFreightLineObject,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { i18nState } from 'ssh/i18n'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
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
.alveolus-line-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.alveolus-line-list__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}
`

interface AlveolusPropertiesProps {
	content: Alveolus
	game?: Game
}

const AlveolusProperties = (props: AlveolusPropertiesProps) => {
	const state = reactive({
		working: false,
		isStorage: false,
		storageContent: undefined as StorageAlveolus | undefined,
		lineObjects: [] as SyntheticFreightLineObject[],
		resolvedGame: undefined as Game | undefined,
	})

	effect`alveolus-properties:storage-check`(() => {
		const content = props.content
		const game = props.game ?? content?.game
		state.resolvedGame = game
		state.isStorage = content instanceof StorageAlveolus
		state.storageContent = content instanceof StorageAlveolus ? content : undefined
		state.working = content?.working ?? false
		state.lineObjects = game
			? findFreightLinesForStop(game.freightLines, content).map((line) =>
					createSyntheticFreightLineObject(game, line)
				)
			: []
	})

	const handleWorkingChange = (checked: boolean) => {
		if (!props.content) return
		props.content.working = checked
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

			<PropertyGridRow
				if={state.lineObjects.length > 0}
				label={i18nState.translator?.line?.section ?? 'Line'}
			>
				<div class="alveolus-line-list">
					<for each={state.lineObjects}>
						{(lineObject) => (
							<div class="alveolus-line-list__item">
								<LinkedEntityControl object={lineObject} />
								<InspectorObjectLink object={lineObject} />
							</div>
						)}
					</for>
				</div>
			</PropertyGridRow>

			<StoredGoodsRow
				if={state.resolvedGame}
				content={props.content}
				game={state.resolvedGame!}
				label={String(i18nState.translator?.goods.stored ?? '')}
			/>

			<StorageConfiguration
				if={state.isStorage && state.resolvedGame}
				content={state.storageContent!}
				game={state.resolvedGame!}
			/>
		</>
	)
}

export default AlveolusProperties
