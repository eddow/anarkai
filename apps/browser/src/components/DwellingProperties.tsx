import { css } from '@app/lib/css'
import { Badge } from '@app/ui/anarkai'
import { effect, reactive } from 'mutts'
import type { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { getTranslator } from '@app/lib/i18n'
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

const DwellingProperties = (props: DwellingPropertiesProps) => {
	const state = reactive({
		capacity: 0,
		occupied: false,
	})

	effect`dwelling-properties:stats`(() => {
		state.capacity = props.content?.capacity ?? 0
		state.occupied = Boolean(props.content?.reservedBy)
	})


	return (
		<>
			<PropertyGridRow label={String(getTranslator().residential.dwelling.section)}>
				<div class="dwelling-properties">
					<Badge tone="blue" data-testid="dwelling-tier">
						{getTranslator().residential.dwelling.tierBasic}
					</Badge>
				</div>
			</PropertyGridRow>
			<PropertyGridRow label={String(getTranslator().residential.dwelling.capacity)}>
				<Badge tone="yellow" data-testid="dwelling-capacity">
					{state.capacity}
				</Badge>
			</PropertyGridRow>
			<PropertyGridRow label={String(getTranslator().residential.dwelling.occupied)}>
				<Badge tone={state.occupied ? 'red' : 'green'} data-testid="dwelling-occupied">
					{state.occupied ? getTranslator().residential.dwelling.occupied : getTranslator().residential.dwelling.vacant}
				</Badge>
			</PropertyGridRow>
		</>
	)
}

export default DwellingProperties
