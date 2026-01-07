import { effect, reactive } from 'mutts'
import { Button } from 'pounce-ui/src'
import { css } from '$lib/css'
import AlveolusFlag from './AlveolusFlag'
import PropertyGridRow from './PropertyGridRow'
import type { Alveolus } from '$lib/game/board/content/alveolus'
import { T } from '$lib/i18n'

css`
.alveolus-commands {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}

.alveolus-commands--confirming {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.alveolus-commands__text {
	font-size: 0.875rem;
	color: var(--pico-color);
}
`

interface AlveolusPropertiesProps {
	content: Alveolus
}

const AlveolusProperties = ({ content }: AlveolusPropertiesProps) => {
	const state = reactive({
		working: content.working,
		isStorageEmpty: content.storage?.isEmpty ?? true,
		isConfirming: false,
	})

	effect(() => {
		state.working = content.working
		state.isStorageEmpty = content.storage?.isEmpty ?? true
	})

	const handleWorkingChange = (checked: boolean) => {
		content.working = checked
		state.working = checked
	}

	const handleCleanUp = () => {
		state.isConfirming = true
	}

	const confirmCleanUp = () => {
		content.cleanUp()
		state.isConfirming = false
		console.log('Clean up completed for alveolus:', content.name)
	}

	const cancelCleanUp = () => {
		state.isConfirming = false
	}

	return (
		<PropertyGridRow label={String(T.alveolus.commands)}>
			{state.isConfirming ? (
				<div class="alveolus-commands alveolus-commands--confirming">
					<span class="alveolus-commands__text">{String(T.alveolus.cleanUpConfirmText)}</span>
					<Button onClick={confirmCleanUp}>
						{String(T.alveolus.clear)}
					</Button>
					<Button onClick={cancelCleanUp}>
						{String(T.alveolus.keep)}
					</Button>
				</div>
			) : (
				<div class="alveolus-commands">
					<AlveolusFlag
						checked={state.working}
						icon="mdi:cog"
						name={String(T.alveolus.working)}
						tooltip={String(T.alveolus.workingTooltip)}
						onChange={handleWorkingChange}
					/>
					{!state.isStorageEmpty && (
						<Button onClick={handleCleanUp} aria-label={String(T.alveolus.cleanUpTooltip)}>
							{String(T.alveolus.cleanUp)}
						</Button>
					)}
				</div>
			)}
		</PropertyGridRow>
	)
}

export default AlveolusProperties

