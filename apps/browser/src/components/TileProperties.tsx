import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { Badge, InspectorSection } from '@app/ui/anarkai'
import {
	alveoli as visualAlveoli,
	dwellings as visualDwellings,
} from 'engine-pixi/assets/visual-content'
import { effect, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { queryConstructionSiteView } from 'ssh/construction'
import { BuildAlveolus } from 'ssh/hive/build'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import { computeStyleFromTexture } from 'ssh/utils/images'
import AlveolusProperties from './AlveolusProperties'
import ConstructionProgressBar from './ConstructionProgressBar'
import DwellingProperties from './DwellingProperties'
import EntityBadge from './EntityBadge'
import GoodsList from './GoodsList'
import HiveAnchorButton from './HiveAnchorButton'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'
import StoredGoodsRow from './storage/StoredGoodsRow'
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
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    margin-bottom: 1rem;
  }

  .tile-properties__header-hive {
    flex: none;
    margin-inline-start: auto;
  }

  .tile-properties__content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
`

interface TilePropertiesProps {
	tile?: Tile
}

const resolveTileTerrain = (tile: Tile | undefined): string => {
	if (!tile) return 'grass'
	return tile.terrainState?.terrain ?? tile.baseTerrain ?? 'grass'
}

const resolveTileTerrainForContent = (tile: Tile | undefined, content: Tile['content']): string => {
	const terrain = resolveTileTerrain(tile)
	if (content instanceof Alveolus && terrain === 'grass') {
		// Backward-compatible inspector fallback for older states where alveolus tiles
		// were concrete visually but no explicit terrain patch was persisted.
		return 'concrete'
	}
	return terrain
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

const resolveAlveolusVisualType = (
	content: Alveolus
): keyof typeof visualAlveoli | undefined => {
	if (content instanceof BuildAlveolus) {
		return content.target as keyof typeof visualAlveoli
	}
	return content.name as keyof typeof visualAlveoli | undefined
}

const TileProperties = (props: TilePropertiesProps) => {
	const currentTile = () => props.tile
	const currentGame = () => currentTile()?.board?.game
	const state = reactive({
		tileContent: undefined as Tile['content'],
		stock: undefined as Record<string, number> | undefined,
		freeStock: {} as Record<string, number>,
		storedGoods: [] as GoodType[],
		looseGoods: [] as GoodType[],
		contentInfo: undefined as
			| {
					type?: keyof typeof visualAlveoli
					sprite?: string
					name?: string
					terrain: string
			  }
			| undefined,
		dwellingConstruction: {
			show: false,
			phaseLabel: '',
			blocking: [] as string[],
			workLine: '',
			applied: 0,
			total: 0,
		},
		terrainBackgroundStyle: '',
		hiveHeaderTitle: '',
	})

	effect`tile-properties:content`(() => {
		const tile = currentTile()
		const content = tile?.content
		const translator = i18nState.translator
		state.tileContent = content

		if (content instanceof Alveolus) {
			const type = resolveAlveolusVisualType(content)
			const visual = type ? visualAlveoli[type] : undefined
			state.contentInfo = {
				type,
				sprite: visual?.sprites?.[0],
				name:
					type && translator
						? toDisplayText(
								translator.alveoli?.[type as keyof typeof translator.alveoli],
								content.title
							)
						: content.title,
				terrain: resolveTileTerrainForContent(tile, content),
			}
			const hiveName = content.hive?.name?.trim()
			state.hiveHeaderTitle = hiveName ? hiveName : 'Hive'
		} else if (content instanceof BasicDwelling) {
			const visual = visualDwellings.basic_dwelling
			state.hiveHeaderTitle = ''
			state.contentInfo = {
				sprite: visual?.sprites?.[0],
				name: translator
					? toDisplayText(
							(translator as { residential?: { dwelling?: { tierBasic?: string } } })?.residential
								?.dwelling?.tierBasic,
							content.title
						)
					: content.title,
				terrain: resolveTileTerrainForContent(tile, content),
			}
		} else if (content instanceof BuildDwelling) {
			state.hiveHeaderTitle = ''
			state.contentInfo = {
				name: translator
					? toDisplayText(
							(translator as { construction?: { section?: string } } | undefined)?.construction
								?.section,
							content.name
						)
					: content.name,
				terrain: resolveTileTerrainForContent(tile, content),
			}
		} else if (content instanceof UnBuiltLand) {
			state.hiveHeaderTitle = ''
			state.contentInfo = {
				terrain: content.terrain,
			}
		} else {
			state.hiveHeaderTitle = ''
			state.contentInfo = {
				terrain: resolveTileTerrainForContent(tile, content),
			}
		}
	})

	effect`tile-properties:dwelling-construction`(() => {
		const tile = currentTile()
		const content = tile?.content
		const game = currentGame()
		if (!game || !tile || !(content instanceof BuildDwelling)) {
			state.dwellingConstruction.show = false
			return
		}
		const snap = queryConstructionSiteView(game, tile)
		if (!snap) {
			state.dwellingConstruction.show = false
			return
		}
		const model = buildConstructionViewModel(
			snap,
			i18nState.translator as ConstructionTranslatorShape | undefined
		)
		state.dwellingConstruction.show = true
		state.dwellingConstruction.phaseLabel = model.phaseLabel
		state.dwellingConstruction.blocking = model.blockingLabels
		state.dwellingConstruction.workLine = model.workLine
		state.dwellingConstruction.applied = model.applied
		state.dwellingConstruction.total = model.total
	})

	effect`tile-properties:stock`(() => {
		const content = state.tileContent
		if (content?.storage) {
			state.stock = content.storage.stock
			state.storedGoods = Object.keys(content.storage.stock ?? {}) as GoodType[]
		} else {
			state.stock = undefined
			state.storedGoods = []
		}
	})

	effect`tile-properties:free-stock`(() => {
		const counts: Record<string, number> = {}
		for (const fg of currentTile()?.looseGoods ?? []) {
			if (!fg.available) continue
			counts[fg.goodType] = (counts[fg.goodType] ?? 0) + 1
		}
		state.freeStock = counts
		state.looseGoods = Object.keys(counts) as GoodType[]
	})

	effect`tile-properties:terrain-bg`(() => {
		if (state.contentInfo?.terrain) {
			void (async () => {
				const game = currentGame()
				await game?.loaded
				if (!game) return
				const texture = game.getTexture(`terrain.${state.contentInfo?.terrain}`)
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
			if={state.tileContent && currentTile()}
			class={`tile-properties ${state.terrainBackgroundStyle ? 'has-terrain' : ''}`}
			style={state.terrainBackgroundStyle}
		>
			{(state.contentInfo?.type || state.contentInfo?.sprite) && (
				<div class="tile-properties__header">
					<EntityBadge
						game={currentGame()}
						sprite={state.contentInfo.sprite ?? ''}
						text={state.contentInfo.name ?? ''}
						height={32}
					/>
					<div if={state.tileContent instanceof Alveolus} class="tile-properties__header-hive">
						<HiveAnchorButton tile={currentTile()} title={state.hiveHeaderTitle} />
					</div>
				</div>
			)}

			<InspectorSection class="tile-properties__content">
				<PropertyGrid>
					<PropertyGridRow
						if={currentTile()?.zone}
						label={String(i18nState.translator?.tile.zone ?? '')}
					>
						<Badge tone={currentTile()?.zone === 'residential' ? 'green' : 'yellow'}>
							{currentTile()?.zone === 'residential'
								? String(i18nState.translator?.tile.zoneResidential ?? 'residential')
								: String(i18nState.translator?.tile.zoneHarvest ?? 'harvest')}
						</Badge>
					</PropertyGridRow>

					<PropertyGridRow label={String(i18nState.translator?.tile.walkTime ?? '')}>
						<Badge
							tone={state.tileContent?.walkTime === Number.POSITIVE_INFINITY ? 'red' : 'yellow'}
						>
							{state.tileContent?.walkTime === Number.POSITIVE_INFINITY
								? String(i18nState.translator?.tile.unwalkable ?? '')
								: state.tileContent?.walkTime}
						</Badge>
					</PropertyGridRow>

					{state.storedGoods.length > 0 &&
					!(state.tileContent instanceof Alveolus) &&
					!(state.tileContent instanceof BasicDwelling) &&
					!(state.tileContent instanceof BuildDwelling) ? (
						<PropertyGridRow label={String(i18nState.translator?.goods.stored ?? '')}>
							<GoodsList
								goods={state.storedGoods}
								game={currentGame()}
								getBadgeProps={(g) => ({ qty: state.stock?.[g] ?? 0 })}
							/>
						</PropertyGridRow>
					) : null}

					<PropertyGridRow
						if={state.dwellingConstruction.show}
						label={toDisplayText(
							(i18nState.translator as { construction?: { section?: string } } | undefined)
								?.construction?.section,
							'Construction'
						)}
					>
						<div style="display:grid; gap:0.5rem; width:100%;">
							<div style="display:flex; flex-wrap:wrap; gap:0.25rem; align-items:center;">
								<span>{state.dwellingConstruction.phaseLabel}</span>
								<for each={state.dwellingConstruction.blocking}>
									{(text) => <span style="color: var(--ak-text-muted)"> · {text}</span>}
								</for>
							</div>
							<ConstructionProgressBar
								if={state.dwellingConstruction.total > 0}
								applied={state.dwellingConstruction.applied}
								total={state.dwellingConstruction.total}
								label={state.dwellingConstruction.workLine}
								testId="dwelling-construction-progress"
							/>
						</div>
					</PropertyGridRow>

					<StoredGoodsRow
						if={
							currentGame() &&
							(state.tileContent instanceof BasicDwelling ||
								state.tileContent instanceof BuildDwelling)
						}
						content={state.tileContent as BasicDwelling | BuildDwelling}
						game={currentGame()!}
						label={String(
							state.tileContent instanceof BuildDwelling
								? ((i18nState.translator as { construction?: { materials?: string } } | undefined)
										?.construction?.materials ??
										i18nState.translator?.goods.stored ??
										'')
								: (i18nState.translator?.goods.stored ?? '')
						)}
					/>

					{state.looseGoods.length > 0 ? (
						<PropertyGridRow label={String(i18nState.translator?.goods.loose ?? '')}>
							<GoodsList
								goods={state.looseGoods}
								game={currentGame()}
								getBadgeProps={(g) => ({ qty: state.freeStock[g] })}
							/>
						</PropertyGridRow>
					) : null}

					{state.tileContent instanceof UnBuiltLand ? (
						<UnBuiltProperties content={state.tileContent} />
					) : null}
					{state.tileContent instanceof BasicDwelling ? (
						<DwellingProperties content={state.tileContent} />
					) : null}
					{state.tileContent instanceof Alveolus ? (
						<AlveolusProperties content={state.tileContent} game={currentGame()} />
					) : null}
				</PropertyGrid>
			</InspectorSection>
		</div>
	)
}

export default TileProperties
