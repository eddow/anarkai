import { css } from '@app/lib/css'
import { addFreightDraftStop } from '@app/lib/freight-line-draft'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import { getTranslator } from '@app/lib/i18n'
import FreightStopCard from './FreightStopCard'

css`
.freight-stop-list {
	display: flex;
	flex-direction: column;
	gap: 0.65rem;
	margin-top: 0.75rem;
}
.freight-stop-list__add {
	padding: 0.35rem 0.55rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
	font-size: 0.8rem;
	align-self: flex-start;
}
.freight-stop-list__add[disabled] {
	opacity: 0.55;
	cursor: not-allowed;
}
`

interface FreightStopListProps {
	draft?: FreightLineDefinition
	game: Game
	readOnly: boolean
	onChange: (next: FreightLineDefinition) => void
}

const FreightStopList = (props: FreightStopListProps) => {
	const t = () => getTranslator().line.stopsEditor
	const currentDraft = () => props.draft
	const stopsIndexed = (): { stop: FreightStop; index: number }[] =>
		(currentDraft()?.stops ?? []).map((stop, index) => ({ stop, index }))
	const apply = (fn: (line: FreightLineDefinition) => FreightLineDefinition) => {
		const draft = currentDraft()
		if (!draft) return
		props.onChange(fn(draft))
	}
	const handleAdd = () => {
		const draft = currentDraft()
		if (props.readOnly || !draft) return
		props.onChange(addFreightDraftStop(draft, draft.stops.length))
	}

	return (
		<div class="freight-stop-list">
			<for each={stopsIndexed()}>
				{({ stop, index }: { stop: FreightStop; index: number }) => (
					<FreightStopCard
						stop={stop}
						index={index}
						total={currentDraft()?.stops.length ?? 0}
						game={props.game}
						lineId={currentDraft()?.id ?? ''}
						readOnly={props.readOnly}
						apply={apply}
					/>
				)}
			</for>
			<button
				type="button"
				class="freight-stop-list__add"
				disabled={props.readOnly}
				onClick={handleAdd}
				data-testid="freight-stop-add"
			>
				{t().addStop}
			</button>
		</div>
	)
}

export default FreightStopList
