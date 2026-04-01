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

const UnBuiltProperties = (props: UnBuiltPropertiesProps) => {
	const state = reactive({
		deposit: undefined as
			| {
					sprites: string[]
					name: string
					amount: number
			  }
			| undefined,
		projectData: undefined as
			| {
					project: string
					name: string
			  }
			| undefined,
	})

	effect`unbuilt-properties:deposit`(() => {
		const deposit = props.content?.deposit
		const name = deposit
			? ((deposit.constructor as { key?: string }).key ?? deposit.constructor.name)
			: ''
		state.deposit = deposit
			? {
					sprites: visualDeposits[name as keyof typeof visualDeposits]?.sprites ?? [],
					name,
					amount: deposit.amount,
				}
			: undefined
	})

	effect`unbuilt-properties:project`(() => {
		const proj = props.content?.project
		state.projectData = proj ? { project: proj, name: proj.replace('build:', '') } : undefined
	})

	return (
		<>
			{state.projectData ? (
				<PropertyGridRow label={String(i18nState.translator?.project ?? '')}>
					<div class="unbuilt-project">
						<Badge tone="blue">
							{state.projectData.name
								? String(
										i18nState.translator?.alveoli?.[
											state.projectData.name as keyof typeof i18nState.translator.alveoli
										] ?? ''
									)
								: state.projectData.project}
						</Badge>
						{!props.content?.tile?.isClear ? (
							<Badge tone="yellow">{String(i18nState.translator?.clearing ?? '')}</Badge>
						) : null}
					</div>
				</PropertyGridRow>
			) : null}

			{state.deposit?.amount !== undefined &&
			state.deposit.sprites &&
			state.deposit.sprites.length > 0 ? (
				<PropertyGridRow label={String(i18nState.translator?.deposit ?? '')}>
					<EntityBadge
						game={props.content?.tile?.board?.game}
						height={16}
						sprite={state.deposit.sprites[0]}
						text={String(
							i18nState.translator?.deposits?.[
								state.deposit.name as keyof typeof i18nState.translator.deposits
							] ?? ''
						)}
						qty={state.deposit.amount}
					/>
				</PropertyGridRow>
			) : null}
		</>
	)
}

export default UnBuiltProperties
