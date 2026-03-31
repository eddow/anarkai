import { css } from '@app/lib/css'
import { Badge, InspectorSection } from '@app/ui/anarkai'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import { computeStyleFromTexture } from 'ssh/utils/images'
import AlveolusProperties from './AlveolusProperties'
import EntityBadge from './EntityBadge'
import GoodsList from './GoodsList'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import UnBuiltProperties from './UnBuiltProperties'

css`
  .tile-properties {
    padding: 1rem;
  }

  .tile-properties.has-terrain {
    position: relative;
  }

  .tile-properties__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .tile-properties__content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
`

interface TilePropertiesProps {
	tile: Tile
}

const TileProperties = (props: TilePropertiesProps) => {
	const state = reactive({
		tileContent: undefined as Tile['content'],
		stock: undefined as Record<string, number> | undefined,
		freeStock: {} as Record<string, number>,
		contentInfo: undefined as
			| {
					type?: keyof typeof visualAlveoli
					sprite?: string
					name?: string
					terrain: string
			  }
			| undefined,
		terrainBackgroundStyle: '',
	})

	effect`tile-properties:content`(() => {
		const content = props.tile?.content
		const translator = i18nState.translator
		state.tileContent = content

		if (content instanceof Alveolus) {
			const type = content.name as keyof typeof visualAlveoli | undefined
			const visual = type ? visualAlveoli[type] : undefined
			state.contentInfo = {
				type,
				sprite: visual?.sprites?.[0],
				name: type && translator ? String(translator.alveoli[type]) : content.title,
				terrain: 'concrete',
			}
		} else if (content instanceof UnBuiltLand) {
			state.contentInfo = {
				terrain: content.terrain,
			}
		} else {
			state.contentInfo = {
				terrain: 'concrete',
			}
		}
	})

	effect`tile-properties:stock`(() => {
		const content = state.tileContent
		if (content?.storage) {
			state.stock = content.storage.stock
		} else {
			state.stock = undefined
		}
	})

	effect`tile-properties:free-stock`(() => {
		const counts: Record<string, number> = {}
		for (const fg of props.tile?.looseGoods ?? []) {
			if (!fg.available) continue
			counts[fg.goodType] = (counts[fg.goodType] ?? 0) + 1
		}
		state.freeStock = counts
	})

	effect`tile-properties:terrain-bg`(() => {
		if (state.contentInfo?.terrain) {
			void (async () => {
				await props.tile?.board?.game?.loaded
				if (!props.tile?.board?.game) return
				const texture = props.tile?.board?.game?.getTexture(`terrain.${state.contentInfo?.terrain}`)
				state.terrainBackgroundStyle = texture
					? computeStyleFromTexture(texture, {
							backgroundRepeat: 'repeat',
						})
					: ''
			})()
		} else {
			state.terrainBackgroundStyle = ''
		}
	})

	return (
		<div
			if={state.tileContent}
			class={`tile-properties ${state.terrainBackgroundStyle ? 'has-terrain' : ''}`}
			style={state.terrainBackgroundStyle}
		>
			{state.contentInfo?.type && (
				<div class="tile-properties__header">
					<EntityBadge
						game={props.tile?.board?.game}
						sprite={state.contentInfo.sprite ?? ''}
						text={state.contentInfo.name ?? ''}
						height={32}
					/>
				</div>
			)}

			<InspectorSection class="tile-properties__content">
				<PropertyGrid>
					<PropertyGridRow label={String(i18nState.translator?.tile.walkTime ?? '')}>
						<Badge
							tone={
								state.tileContent?.walkTime === Number.POSITIVE_INFINITY ? 'red' : 'yellow'
							}
						>
							{state.tileContent?.walkTime === Number.POSITIVE_INFINITY
								? String(i18nState.translator?.tile.unwalkable ?? '')
								: state.tileContent?.walkTime}
						</Badge>
					</PropertyGridRow>

					{state.stock && !(state.tileContent instanceof Alveolus) ? (
						<PropertyGridRow label={String(i18nState.translator?.goods.stored ?? '')}>
							<GoodsList
								goods={Object.keys(state.stock) as GoodType[]}
								game={props.tile?.board?.game}
								getBadgeProps={(g) => ({ qty: state.stock![g] })}
							/>
						</PropertyGridRow>
					) : null}

					{Object.keys(state.freeStock).length > 0 ? (
						<PropertyGridRow label={String(i18nState.translator?.goods.loose ?? '')}>
							<GoodsList
								goods={Object.keys(state.freeStock) as GoodType[]}
								game={props.tile?.board?.game}
								getBadgeProps={(g) => ({ qty: state.freeStock[g] })}
							/>
						</PropertyGridRow>
					) : null}

					{state.tileContent instanceof UnBuiltLand ? (
						<UnBuiltProperties content={state.tileContent} />
					) : null}
					{state.tileContent instanceof Alveolus ? (
						<AlveolusProperties content={state.tileContent} game={props.tile?.board?.game} />
					) : null}
				</PropertyGrid>
			</InspectorSection>
		</div>
	)
}

export default TileProperties
