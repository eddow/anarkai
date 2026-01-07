import { effect, reactive } from 'mutts'
import EntityBadge from './EntityBadge'
import PropertyGridRow from './PropertyGridRow'
import { css } from '$lib/css'
import type { UnBuiltLand } from '$lib/game/board/content/unbuilt-land'
import { T } from '$lib/i18n'

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
        sprites: deposit.sprites,
        name: deposit.name,
        amount: deposit.amount,
      }
      : undefined
  })

  effect(() => {
    const proj = content.project
    state.projectData = proj
      ? { project: proj, name: proj.replace('build:', '') }
      : undefined
  })

  return (
    <>
      {state.projectData ? (
        <PropertyGridRow label={String(T.project)}>
          <div class="unbuilt-project">
            <span class="badge badge-blue">
              {state.projectData.name ? String(T.alveoli[state.projectData.name as keyof typeof T.alveoli]) : state.projectData.project}
            </span>
            {!content.tile.isClear ? <span class="badge badge-yellow">{String(T.clearing)}</span> : null}
          </div>
        </PropertyGridRow>
      ) : null}

      {state.deposit?.amount !== undefined ? (
        <PropertyGridRow label={String(T.deposit)}>
          <EntityBadge
            game={content.tile.board.game}
            height={16}
            sprite={state.deposit.sprites[0]}
            text={String(T.deposits[state.deposit.name as keyof typeof T.deposits])}
            qty={state.deposit.amount}
          />
        </PropertyGridRow>
      ) : null}
    </>
  )
}

export default UnBuiltProperties

