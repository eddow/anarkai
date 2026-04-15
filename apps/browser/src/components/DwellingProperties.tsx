import { css } from '@app/lib/css'
import { Badge } from '@app/ui/anarkai'
import { effect, reactive } from 'mutts'
import type { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { i18nState } from 'ssh/i18n'
import PropertyGridRow from './PropertyGridRow'

css`
  .dwelling-properties {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
`

interface DwellingPropertiesProps {
	content: BasicDwelling
}

const toDisplayText = (value: unknown, fallback = ''): string => {
	switch (typeof value) {
		case 'string':
			return value
		case 'number':
		case 'boolean':
			return `${value}`
		default:
			return fallback
	}
}

const DwellingProperties = (props: DwellingPropertiesProps) => {
	const state = reactive({
		capacity: 0,
		occupied: false,
	})

	effect`dwelling-properties:stats`(() => {
		state.capacity = props.content?.capacity ?? 0
		state.occupied = Boolean(props.content?.reservedBy)
	})

	const residential = i18nState.translator as
		| {
				residential?: {
					dwelling?: {
						section?: string
						tier?: string
						tierBasic?: string
						capacity?: string
						occupied?: string
						vacant?: string
					}
				}
		  }
		| undefined

	return (
		<>
			<PropertyGridRow label={toDisplayText(residential?.dwelling?.section, 'Housing')}>
				<div class="dwelling-properties">
					<Badge tone="blue" data-testid="dwelling-tier">
						{toDisplayText(residential?.dwelling?.tierBasic, 'basic_dwelling')}
					</Badge>
				</div>
			</PropertyGridRow>
			<PropertyGridRow label={toDisplayText(residential?.dwelling?.capacity, 'Capacity')}>
				<Badge tone="yellow" data-testid="dwelling-capacity">
					{state.capacity}
				</Badge>
			</PropertyGridRow>
			<PropertyGridRow label={toDisplayText(residential?.dwelling?.occupied, 'Occupied')}>
				<Badge tone={state.occupied ? 'red' : 'green'} data-testid="dwelling-occupied">
					{toDisplayText(
						state.occupied ? residential?.dwelling?.occupied : residential?.dwelling?.vacant,
						state.occupied ? 'yes' : 'no'
					)}
				</Badge>
			</PropertyGridRow>
		</>
	)
}

export default DwellingProperties
