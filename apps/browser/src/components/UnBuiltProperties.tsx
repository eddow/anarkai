import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { Badge } from '@app/ui/anarkai'
import { deposits as visualDeposits } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { type ConstructionPhase, queryConstructionSiteView } from 'ssh/construction'
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
		constructionPhase: '' as ConstructionPhase | '',
		constructionPhaseLabel: '',
		constructionBlocking: [] as string[],
		showConstruction: false,
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
		state.projectName =
			typeof proj === 'string'
				? proj.startsWith('build:')
					? proj.slice('build:'.length)
					: proj.startsWith('residential:')
						? proj.slice('residential:'.length)
						: proj
				: ''
		state.isClearing = !props.content?.tile?.isClear
	})

	effect`unbuilt-properties:construction`(() => {
		const game = props.content?.tile?.board?.game
		const tile = props.content?.tile
		if (!game || !tile || !props.content?.constructionSite) {
			state.showConstruction = false
			state.constructionPhase = ''
			state.constructionPhaseLabel = ''
			state.constructionBlocking = []
			return
		}
		const snap = queryConstructionSiteView(game, tile)
		if (!snap) {
			state.showConstruction = false
			return
		}
		state.showConstruction = true
		state.constructionPhase = snap.phase
		const model = buildConstructionViewModel(
			snap,
			i18nState.translator as ConstructionTranslatorShape | undefined
		)
		state.constructionPhaseLabel = model.phaseLabel
		state.constructionBlocking = model.blockingLabels
	})

	return (
		<>
			<PropertyGridRow if={state.showProject} label={toDisplayText(i18nState.translator?.project)}>
				<div class="unbuilt-project">
					<Badge tone="blue">
						{toDisplayText(
							state.project.startsWith('residential:')
								? (
										i18nState.translator as
											| { residential?: { projectBasicDwelling?: string } }
											| undefined
									)?.residential?.projectBasicDwelling
								: i18nState.translator?.alveoli?.[
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

			<PropertyGridRow
				if={state.showConstruction}
				label={toDisplayText(
					(i18nState.translator as { construction?: { section?: string } } | undefined)
						?.construction?.section,
					'Construction'
				)}
			>
				<div class="unbuilt-project">
					<Badge tone="blue">{state.constructionPhaseLabel}</Badge>
					<for each={state.constructionBlocking}>
						{(text) => (
							<Badge if={text.length > 0} tone="yellow">
								{text}
							</Badge>
						)}
					</for>
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
