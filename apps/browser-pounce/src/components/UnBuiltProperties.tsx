import { css } from '@app/lib/css'
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

const UnBuiltProperties = ({ content }: UnBuiltPropertiesProps) => {
	const translator = i18nState.translator
	if (!translator) return null
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

	effect(() => {
		const deposit = content.deposit
		state.deposit = deposit
			? {
					sprites: deposit.sprites || [],
					name: deposit.name,
					amount: deposit.amount,
				}
			: undefined
	})

	effect(() => {
		const proj = content.project
		state.projectData = proj ? { project: proj, name: proj.replace('build:', '') } : undefined
	})

	return (
		<>
			{state.projectData ? (
				<PropertyGridRow label={String(translator.project)}>
					<div class="unbuilt-project">
						<span class="badge badge-blue">
							{state.projectData.name
								? String(
										translator.alveoli[state.projectData.name as keyof typeof translator.alveoli]
									)
								: state.projectData.project}
						</span>
						{!content.tile.isClear ? (
							<span class="badge badge-yellow">{String(translator.clearing)}</span>
						) : null}
					</div>
				</PropertyGridRow>
			) : null}

			{state.deposit?.amount !== undefined &&
			state.deposit.sprites &&
			state.deposit.sprites.length > 0 ? (
				<PropertyGridRow label={String(translator.deposit)}>
					<EntityBadge
						game={content.tile.board.game}
						height={16}
						sprite={state.deposit.sprites[0]}
						text={String(
							translator.deposits[state.deposit.name as keyof typeof translator.deposits]
						)}
						qty={state.deposit.amount}
					/>
				</PropertyGridRow>
			) : null}
		</>
	)
}

export default UnBuiltProperties
