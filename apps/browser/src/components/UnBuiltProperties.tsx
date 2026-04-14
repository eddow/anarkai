import { css } from '@app/lib/css'
import { Badge } from '@app/ui/anarkai'
import { deposits as visualDeposits } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { i18nState } from 'ssh/i18n'
import EntityBadge from './EntityBadge'
import PropertyGridRow from './PropertyGridRow'

css`
  .unbuilt-project {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
`

interface UnBuiltPropertiesProps {
	content: UnBuiltLand
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

const UnBuiltProperties = (props: UnBuiltPropertiesProps) => {
	const state = reactive({
		depositAmount: undefined as number | undefined,
		depositName: '',
		depositSprite: '',
		showDeposit: false,
		project: '',
		projectName: '',
		showProject: false,
		isClearing: false,
	})

	effect`unbuilt-properties:deposit`(() => {
		const deposit = props.content?.deposit
		const rawName = deposit
			? ((deposit.constructor as { key?: unknown }).key ?? deposit.constructor.name)
			: ''
		const name = toDisplayText(rawName)
		const sprite = visualDeposits[name as keyof typeof visualDeposits]?.sprites?.[0] ?? ''
		state.depositName = name
		state.depositAmount = deposit?.amount
		state.depositSprite = sprite
		state.showDeposit = deposit?.amount !== undefined && sprite.length > 0
	})

	effect`unbuilt-properties:project`(() => {
		const proj = props.content?.project
		state.showProject = typeof proj === 'string'
		state.project = typeof proj === 'string' ? proj : ''
		state.projectName = typeof proj === 'string' ? proj.replace('build:', '') : ''
		state.isClearing = !props.content?.tile?.isClear
	})

	return (
		<>
			<PropertyGridRow if={state.showProject} label={toDisplayText(i18nState.translator?.project)}>
				<div class="unbuilt-project">
					<Badge tone="blue">
						{toDisplayText(
							i18nState.translator?.alveoli?.[
								state.projectName as keyof NonNullable<typeof i18nState.translator>['alveoli']
							],
							state.project
						)}
					</Badge>
					<Badge if={state.isClearing} tone="yellow">
						{toDisplayText(i18nState.translator?.clearing)}
					</Badge>
				</div>
			</PropertyGridRow>

			<PropertyGridRow if={state.showDeposit} label={toDisplayText(i18nState.translator?.deposit)}>
				<EntityBadge
					game={props.content?.tile?.board?.game}
					height={16}
					sprite={state.depositSprite}
					text={toDisplayText(
						i18nState.translator?.deposits?.[
							state.depositName as keyof NonNullable<typeof i18nState.translator>['deposits']
						],
						state.depositName
					)}
					qty={state.depositAmount}
				/>
			</PropertyGridRow>
		</>
	)
}

export default UnBuiltProperties
