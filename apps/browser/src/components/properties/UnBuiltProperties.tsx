import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
import { presentationRevisionFor } from '@app/lib/presentation-events'
import { Badge } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { deposits as visualDeposits, goods as visualGoods } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import {
	tablerFilledZoomMoney,
	tablerOutlineBuildingStore,
	tablerOutlinePolygon,
	tablerOutlineTrees,
} from 'pure-glyf/icons'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { type ConstructionPhase, queryConstructionSiteView } from 'ssh/construction'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from '../EntityBadge'
import PropertyGridRow from '../PropertyGridRow'

css`
  .unbuilt-project {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .unbuilt-zone-title {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    gap: 0.45rem;
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--unbuilt-zone-color, #4f8cff);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--unbuilt-zone-color, #4f8cff) 10%, var(--ak-surface-panel));
    color: var(--ak-text);
    font-weight: 650;
    line-height: 1.2;
  }

  .unbuilt-zone-title :global(.ak-icon) {
    flex: none;
    color: var(--unbuilt-zone-color, #4f8cff);
  }

  .unbuilt-zone-title__text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

const iconForZone = (zoneId: string): string => {
	if (zoneId === 'residential') return tablerFilledZoomMoney
	if (zoneId === 'harvest') return tablerOutlineTrees
	if (zoneId === 'commercial') return tablerOutlineBuildingStore
	return tablerOutlinePolygon
}

const depositLabel = (name: string): string => {
	if (!name) return ''
	return String(T.deposits[name] ?? name)
}

const UnBuiltProperties = (props: UnBuiltPropertiesProps) => {
	const state = reactive({
		zoneId: '',
		zoneName: '',
		zoneColor: '#4f8cff',
		zoneIcon: tablerOutlinePolygon,
		showZone: false,
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
		constructionMaterials: [] as Array<{ good: GoodType; required: number; delivered: number }>,
		constructionTarget: '',
		showConstruction: false,
	})

	effect`unbuilt-properties:zone`(() => {
		const tile = props.content?.tile
		const zoneId = tile?.effectiveZone
		const definition = tile?.board?.game?.hex?.zoneManager?.getZoneDefinition(zoneId)
		state.zoneId = zoneId ? String(zoneId) : ''
		state.zoneName = definition?.name?.trim() || state.zoneId
		state.zoneColor = definition?.color?.trim() || '#4f8cff'
		state.zoneIcon = iconForZone(state.zoneId)
		state.showZone = state.zoneId.length > 0
	})

	effect`unbuilt-properties:deposit`(() => {
		const deposit = props.content?.deposit
		const name = toDisplayText(deposit?.name)
		const sprite = visualDeposits[name as keyof typeof visualDeposits]?.sprites?.[0] ?? ''
		const showDeposit = name.length > 0 && deposit?.amount !== undefined && sprite.length > 0
		if (!showDeposit) state.showDeposit = false
		state.depositName = name
		state.depositAmount = deposit?.amount
		state.depositSprite = sprite
		if (showDeposit) state.showDeposit = true
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
		presentationRevisionFor(tile?.uid)
		if (!game || !tile || !props.content?.constructionSite) {
			state.showConstruction = false
			state.constructionPhase = ''
			state.constructionPhaseLabel = ''
			state.constructionBlocking = []
			state.constructionMaterials = []
			return
		}
		const snap = queryConstructionSiteView(game, tile)
		if (!snap) {
			state.showConstruction = false
			return
		}
		state.showConstruction = true
		state.constructionPhase = snap.phase
		const model = buildConstructionViewModel(snap, T as ConstructionTranslatorShape)
		state.constructionPhaseLabel = model.phaseLabel
		state.constructionBlocking = model.blockingLabels
		state.constructionTarget = model.targetDisplay
		state.constructionMaterials = Object.entries(snap.requiredGoods ?? {}).map(([good, qty]) => ({
			good: good as GoodType,
			required: qty ?? 0,
			delivered: snap.deliveredGoods?.[good as GoodType] ?? 0,
		}))
	})

	return (
		<>
			<PropertyGridRow if={state.showZone}>
				<div
					class="unbuilt-zone-title"
					style={{ '--unbuilt-zone-color': state.zoneColor }}
					title={state.zoneName}
					data-testid="unbuilt-zone-title"
				>
					{renderAnarkaiIcon(state.zoneIcon, { size: 16, label: state.zoneName })}
					<span class="unbuilt-zone-title__text">{state.zoneName}</span>
				</div>
			</PropertyGridRow>

			<PropertyGridRow if={state.showProject} label={String(T.project)}>
				<div class="unbuilt-project">
					<Badge tone="blue">
						{String(
							state.project.startsWith('residential:')
								? T.residential.projectBasicDwelling
								: T.alveoli[state.projectName]
						)}
					</Badge>
					<Badge if={state.isClearing} tone="yellow">
						{T.clearing}
					</Badge>
				</div>
			</PropertyGridRow>

			<PropertyGridRow if={state.showConstruction} label={String(T.construction.section)}>
				<div class="unbuilt-project">
					<Badge if={state.constructionTarget.length > 0} tone="blue">
						{state.constructionTarget}
					</Badge>
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
			<PropertyGridRow
				if={state.constructionMaterials.length > 0}
				label={String(T.construction.materials)}
			>
				<div class="unbuilt-project">
					<for each={state.constructionMaterials}>
						{(material: { good: GoodType; required: number; delivered: number }) => (
							<>
								<EntityBadge
									game={props.content?.tile?.board?.game}
									height={16}
									sprite={visualGoods[material.good]?.sprites?.[0] ?? ''}
									text={String(T.goods?.[material.good] ?? material.good)}
									qtyLabel={`${material.delivered}/${material.required}`}
									qtyTone={material.delivered < material.required ? 'danger' : 'default'}
								/>
							</>
						)}
					</for>
				</div>
			</PropertyGridRow>

			<PropertyGridRow if={state.showDeposit} label={String(T.deposit)}>
				<EntityBadge
					game={props.content?.tile?.board?.game}
					height={16}
					sprite={state.depositSprite}
					text={depositLabel(state.depositName)}
					qty={state.depositAmount}
				/>
			</PropertyGridRow>
		</>
	)
}

export default UnBuiltProperties
