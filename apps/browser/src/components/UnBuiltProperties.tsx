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
import { getTranslator } from '@app/lib/i18n'
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
		const name = toDisplayText(deposit?.name)
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
			getTranslator() as ConstructionTranslatorShape
		)
		state.constructionPhaseLabel = model.phaseLabel
		state.constructionBlocking = model.blockingLabels
	})

	return (
		<>
			<PropertyGridRow if={state.showProject} label={String(getTranslator().project)}>
				<div class="unbuilt-project">
					<Badge tone="blue">
						{String(
							state.project.startsWith('residential:')
								? getTranslator().residential.projectBasicDwelling
								: getTranslator().alveoli[state.projectName]
						)}
					</Badge>
					<Badge if={state.isClearing} tone="yellow">
						{getTranslator().clearing}
					</Badge>
				</div>
			</PropertyGridRow>

			<PropertyGridRow
				if={state.showConstruction}
				label={String(getTranslator().construction.section)}
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

			<PropertyGridRow if={state.showDeposit} label={String(getTranslator().deposit)}>
				<EntityBadge
					game={props.content?.tile?.board?.game}
					height={16}
					sprite={state.depositSprite}
					text={String(getTranslator().deposits[state.depositName])}
					qty={state.depositAmount}
				/>
			</PropertyGridRow>
		</>
	)
}

export default UnBuiltProperties
