import { css } from '@app/lib/css'
import { type FreightDraftIssueCode, freightDraftIssueCodes } from '@app/lib/freight-line-draft'
import { showFreightLineOverlay } from '@app/lib/freight-line-overlay'
import { clearFreightMapPickForLine } from '@app/lib/freight-map-pick'
import { bumpSelectionTitleVersion } from '@app/lib/globals'
import { T } from '@app/lib/i18n'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { InspectorSection } from '@app/ui/anarkai'
import { effect } from 'mutts'
import { tablerOutlineRepeat, tablerOutlineTrash } from 'pure-glyf/icons'
import type { FreightLineDefinition, SyntheticFreightLineObject } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import FreightStopList from '../FreightStopList'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'

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

.freight-line-properties__actions {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.45rem;
	width: 100%;
}

.freight-line-properties__icon-btn {
	display: inline-grid;
	place-items: center;
	inline-size: 2rem;
	block-size: 2rem;
	border-radius: 0.4rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	color: var(--ak-text);
	cursor: pointer;
}

.freight-line-properties__icon-btn[aria-pressed="true"] {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 42%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 14%, var(--ak-surface-panel));
}

.freight-line-properties__icon-btn.danger {
	border-color: color-mix(in srgb, var(--ak-danger, #c44) 35%, transparent);
	color: var(--ak-danger, #c44);
}

.freight-line-properties__issues {
	margin: 0;
	padding-inline-start: 1.1rem;
	font-size: 0.78rem;
	color: var(--ak-danger, #c44);
}

`

interface FreightLinePropertiesProps {
	lineObject: SyntheticFreightLineObject
}

const issueMessage = (code: FreightDraftIssueCode): string => {
	const t = T.line.stopsEditor.issues
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

const icon = (source: string) => renderAnarkaiIcon(source, { size: 16 })

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
		showFreightLineOverlay(lineId)
		return () => {
			if (lineId) clearFreightMapPickForLine(lineId)
			showFreightLineOverlay(undefined)
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

	const handleCyclicInput = (checked: boolean) => {
		const line = currentLine()
		if (readOnly() || !line) return
		replaceLine({ ...line, cyclic: checked ? true : undefined })
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
		<InspectorSection title={T.line.section}>
			<PropertyGrid>
				<PropertyGridRow if={!isAvailable()}>
					<span class="freight-line-properties__uid">{T.line.unavailable}</span>
				</PropertyGridRow>
				<PropertyGridRow if={isAvailable()}>
					<div class="freight-line-properties__actions">
						<button
							type="button"
							class="freight-line-properties__icon-btn"
							title={T.line.cyclic.hint}
							aria-label={T.line.cyclic.label}
							aria-pressed={currentLine()?.cyclic === true ? 'true' : 'false'}
							disabled={!isAvailable()}
							onClick={() => handleCyclicInput(currentLine()?.cyclic !== true)}
							data-testid="freight-line-cyclic"
						>
							{icon(tablerOutlineRepeat)}
						</button>
						<button
							type="button"
							class="freight-line-properties__icon-btn danger"
							title={T.line.deleteLine.action}
							aria-label={T.line.deleteLine.action}
							data-testid="freight-line-delete"
							onClick={handleDeleteLine}
						>
							{icon(tablerOutlineTrash)}
						</button>
					</div>
				</PropertyGridRow>
				<PropertyGridRow label={T.line.name}>
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
					label={T.line.stopsEditor.validation}
				>
					<ul class="freight-line-properties__issues">
						<for each={issues()}>
							{(code: FreightDraftIssueCode) => <li>{issueMessage(code)}</li>}
						</for>
					</ul>
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
