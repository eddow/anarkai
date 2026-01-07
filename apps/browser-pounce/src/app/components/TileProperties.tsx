import { effect, reactive } from 'mutts'
import { alveoli } from '$assets/game-content'
import EntityBadge from './EntityBadge'
import GoodsList from './GoodsList'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import AlveolusProperties from './AlveolusProperties'
import UnBuiltProperties from './UnBuiltProperties'
import { css } from '$lib/css'
import { Alveolus } from '$lib/game/board/content/alveolus'
import { UnBuiltLand } from '$lib/game/board/content/unbuilt-land'
import type { Tile } from '$lib/game/board/tile'
import { T } from '$lib/i18n'
import { computeStyleFromTexture } from '$lib/utils/images'

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

const TileProperties = ({ tile }: TilePropertiesProps) => {
	const state = reactive({
		tileContent: undefined as Tile['content'],
		stock: undefined as Record<string, number> | undefined,
		freeStock: {} as Record<string, number>,
		contentInfo: undefined as
			| {
				type?: keyof typeof alveoli
				sprite?: string
				name?: string
				terrain: string
			}
			| undefined,
		terrainBackgroundStyle: '',
	})

	effect(() => {
		const content = tile.content
		state.tileContent = content

		if (content instanceof Alveolus) {
			const type = content.name as keyof typeof alveoli
			state.contentInfo = {
				type,
				sprite: alveoli[type]?.sprites?.[0],
				name: T.alveoli[type],
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
		for (const fg of tile.freeGoods) {
			if (!fg.available) continue
			counts[fg.goodType] = (counts[fg.goodType] || 0) + 1
		}
		state.freeStock = counts
	})

	effect(() => {
		if (state.contentInfo?.terrain) {
			void (async () => {
				await tile.board.game.loaded
				const texture = tile.board.game.getTexture(`terrain.${state.contentInfo?.terrain}`)
				state.terrainBackgroundStyle = computeStyleFromTexture(texture, {
					backgroundRepeat: 'repeat',
				})
			})()
		} else {
			state.terrainBackgroundStyle = ''
		}
	})

	if (!state.tileContent) return null

	return (
		<div
			class={`tile-properties ${state.terrainBackgroundStyle ? 'has-terrain' : ''}`}
			style={state.terrainBackgroundStyle}
		>
			{state.contentInfo?.type && (
				<div class="tile-properties__header">
					<EntityBadge
						game={tile.board.game}
						sprite={state.contentInfo.sprite ?? ''}
						text={state.contentInfo.name ?? ''}
						height={32}
					/>
				</div>
			)}

			<div class="tile-properties__content">
				<PropertyGrid>
					<PropertyGridRow label={T.tile.walkTime}>
						<span
							class={`badge ${state.tileContent.walkTime === Number.POSITIVE_INFINITY
									? 'badge-red'
									: 'badge-yellow'
								}`}
						>
							{state.tileContent.walkTime === Number.POSITIVE_INFINITY
								? T.tile.unwalkable
								: state.tileContent.walkTime}
						</span>
					</PropertyGridRow>

					{state.stock ? (
						<PropertyGridRow label={T.goods.stored}>
							<GoodsList goods={state.stock} game={tile.board.game} />
						</PropertyGridRow>
					) : null}

					{Object.keys(state.freeStock).length > 0 ? (
						<PropertyGridRow label={T.goods.loose}>
							<GoodsList goods={state.freeStock as any} game={tile.board.game} />
						</PropertyGridRow>
					) : null}

					{state.tileContent instanceof UnBuiltLand ? (
						<UnBuiltProperties content={state.tileContent} />
					) : null}
					{state.tileContent instanceof Alveolus ? (
						<AlveolusProperties content={state.tileContent} />
					) : null}
				</PropertyGrid>
			</div>
		</div>
	)
}

export default TileProperties

