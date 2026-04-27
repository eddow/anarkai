import { css } from '@app/lib/css'
import { type FreightDraftIssueCode, freightDraftIssueCodes } from '@app/lib/freight-line-draft'
import { clearFreightMapPickForLine } from '@app/lib/freight-map-pick'
import { bumpSelectionTitleVersion } from '@app/lib/globals'
import { InspectorSection } from '@app/ui/anarkai'
import { effect } from 'mutts'
import type { FreightLineDefinition, SyntheticFreightLineObject } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { getTranslator } from '@app/lib/i18n'
import FreightStopList from './FreightStopList'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'

css`
.freight-line-properties__name {
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
}

.freight-line-properties__uid {
	font-family: ui-monospace, monospace;
	font-size: 0.75rem;
	color: var(--ak-text-muted);
	word-break: break-word;
}

.freight-line-properties__issues {
	margin: 0;
	padding-inline-start: 1.1rem;
	font-size: 0.78rem;
	color: var(--ak-danger, #c44);
}

.freight-line-properties__delete {
	padding: 0.35rem 0.55rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-danger, #c44) 35%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-danger, #c44);
	cursor: pointer;
	font-size: 0.8rem;
}
`

interface FreightLinePropertiesProps {
	lineObject: SyntheticFreightLineObject
}

const issueMessage = (code: FreightDraftIssueCode): string => {
	const t = getTranslator().line.stopsEditor.issues
	switch (code) {
		case 'no_stops':
			return t.noStops
		case 'no_freight_bay_anchor':
			return t.noBay
		case 'invalid_zone_radius':
			return t.badRadius
		default:
			return code
	}
}

const FreightLineProperties = (props: FreightLinePropertiesProps) => {
	const currentGame = () => props.lineObject?.game
	const currentLine = () => {
		const fallback = props.lineObject?.line
		const lineId = props.lineObject?.lineId
		const g = currentGame()
		if (!fallback || !g || !lineId) return fallback
		return g.freightLines.find((line) => line.id === lineId) ?? fallback
	}
	const isAvailable = () => !!props.lineObject && !!currentLine()
	const readOnly = () => !isAvailable()

	effect`freight-line-properties:pick-cleanup`(() => {
		const lineId = props.lineObject?.lineId
		return () => {
			if (lineId) clearFreightMapPickForLine(lineId)
		}
	})

	const issues = () => {
		const line = currentLine()
		return line ? freightDraftIssueCodes(line) : []
	}

	const replaceLine = (next: FreightLineDefinition) => {
		const g = currentGame()
		if (!g) return
		g.replaceFreightLine(normalizeFreightLineDefinition(next))
		bumpSelectionTitleVersion()
	}

	const onLineChange = (next: FreightLineDefinition) => {
		if (readOnly()) return
		replaceLine(next)
	}

	const handleNameInput = (value: string) => {
		const line = currentLine()
		if (readOnly() || !line) return
		replaceLine({ ...line, name: value })
	}

	const handleDeleteLine = () => {
		const lineId = props.lineObject?.lineId
		const g = currentGame()
		if (!lineId || !g) return
		g.removeFreightLineById(lineId)
		bumpSelectionTitleVersion()
	}

	const lineName = () => currentLine()?.name ?? ''

	return (
		<InspectorSection title={getTranslator().line.section}>
			<PropertyGrid>
				<PropertyGridRow if={!isAvailable()}>
					<span class="freight-line-properties__uid">
						{getTranslator().line.unavailable}
					</span>
				</PropertyGridRow>
				<PropertyGridRow label={getTranslator().line.name}>
					<input
						class="freight-line-properties__name"
						type="text"
						disabled={!isAvailable()}
						value={lineName()}
						onInput={(event) => handleNameInput((event.currentTarget as HTMLInputElement).value)}
						data-testid="freight-line-name"
					/>
				</PropertyGridRow>
				<PropertyGridRow
					if={isAvailable() && issues().length > 0}
					label={getTranslator().line.stopsEditor.validation}
				>
					<ul class="freight-line-properties__issues">
						<for each={issues()}>
							{(code: FreightDraftIssueCode) => <li>{issueMessage(code)}</li>}
						</for>
					</ul>
				</PropertyGridRow>
				<PropertyGridRow
					if={isAvailable()}
					label={getTranslator().line.deleteLine.section}
				>
					<button
						type="button"
						class="freight-line-properties__delete"
						data-testid="freight-line-delete"
						onClick={handleDeleteLine}
					>
						{getTranslator().line.deleteLine.action}
					</button>
				</PropertyGridRow>
			</PropertyGrid>
			<FreightStopList
				if={isAvailable() && currentLine() && currentGame()}
				draft={currentLine()!}
				game={currentGame()!}
				readOnly={readOnly()}
				onChange={onLineChange}
			/>
		</InspectorSection>
	)
}

export default FreightLineProperties
