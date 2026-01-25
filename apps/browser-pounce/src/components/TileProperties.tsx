import { effect, reactive } from 'mutts'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import EntityBadge from './EntityBadge'
import GoodsList from './GoodsList'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import AlveolusProperties from './AlveolusProperties'
import UnBuiltProperties from './UnBuiltProperties'
import { css } from '@app/lib/css'
import { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import { UnBuiltLand } from 'ssh/src/lib/board/content/unbuilt-land'
import type { Tile } from 'ssh/src/lib/board/tile'
import { T, i18nState } from 'ssh/src/lib/i18n'
import { computeStyleFromTexture } from 'ssh/src/lib/utils/images'
import type { GoodType } from 'ssh/src/lib/types/base'

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
	if (!i18nState.translator) return null
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

	effect(() => {
		const content = props.tile?.content
		state.tileContent = content

		if (content instanceof Alveolus) {
			const type = content.name as keyof typeof visualAlveoli
			state.contentInfo = {
				type,
				sprite: visualAlveoli[type]?.sprites?.[0],
				name: String(T.alveoli[type]),
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

	effect(() => {
		const content = state.tileContent
		if (content?.storage) {
			state.stock = content.storage.stock
		} else {
			state.stock = undefined
		}
	})

	effect(() => {
		const counts: Record<string, number> = {}
		for (const fg of (props.tile?.freeGoods ?? [])) {
			if (!fg.available) continue
			counts[fg.goodType] = (counts[fg.goodType] || 0) + 1
		}
		state.freeStock = counts
	})

	effect(() => {
		if (state.contentInfo?.terrain) {
			void (async () => {
				await props.tile?.board?.game?.loaded
				if (!props.tile?.board?.game) return
				const texture = props.tile.board.game.getTexture(`terrain.${state.contentInfo?.terrain}`)
				state.terrainBackgroundStyle = computeStyleFromTexture(texture, {
					backgroundRepeat: 'repeat',
				})
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

			<div class="tile-properties__content">
				<PropertyGrid>
					<PropertyGridRow label={String(T.tile.walkTime)}>
						<span
							class={`badge ${state.tileContent?.walkTime === Number.POSITIVE_INFINITY
								? 'badge-red'
								: 'badge-yellow'
								}`}
						>
							{state.tileContent?.walkTime === Number.POSITIVE_INFINITY
								? String(T.tile.unwalkable)
								: state.tileContent?.walkTime}
						</span>
					</PropertyGridRow>

					{state.stock && !(state.tileContent instanceof Alveolus) ? (
						<PropertyGridRow label={String(T.goods.stored)}>
							<GoodsList
								goods={Object.keys(state.stock) as GoodType[]}
								game={props.tile?.board?.game}
								getBadgeProps={(g) => ({ qty: state.stock![g] })}
							/>
						</PropertyGridRow>
					) : null}

					{Object.keys(state.freeStock).length > 0 ? (
						<PropertyGridRow label={String(T.goods.loose)}>
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
			</div>
		</div>
	)
}

export default TileProperties
