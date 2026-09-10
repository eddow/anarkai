import {
	buildConstructionViewModel,
	type ConstructionTranslatorShape,
} from '@app/lib/construction-view'
import { css } from '@app/lib/css'
import { T } from '@app/lib/i18n'
import { Badge, InspectorSection } from '@app/ui/anarkai'
import { lazy } from '@sursaut/core'
import {
	variantBadges,
	alveoli as visualAlveoli,
	dwellings as visualDwellings,
} from 'engine-rules/visual-content'
import { effect, reactive } from 'mutts'
import * as gameContent from 'ssh/assets/game-content'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { TileBlockingEntry } from 'ssh/board/blocking-details'
import { queryTileBlocking, transformStallReasons } from 'ssh/board/blocking-details'
import type { TileContent } from 'ssh/board/content/content'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isConstructionSiteShell } from 'ssh/build-site'
import { Shop } from 'ssh/commerce/shop'
import { queryConstructionSiteView } from 'ssh/construction'
import { BuildAlveolus } from 'ssh/hive/build'
import { TransformAlveolus } from 'ssh/hive/transform'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { computeStyleFromTexture } from 'ssh/utils/images'
import { toAxialCoord } from 'ssh/utils/position'
import ConstructionProgressBar from '../ConstructionProgressBar'
import EntityBadge from '../EntityBadge'
import GoodsList from '../GoodsList'
import HiveAnchorButton from '../HiveAnchorButton'
import ProjectAnchorButton from '../ProjectAnchorButton'
import PropertyGrid from '../PropertyGrid'
import PropertyGridRow from '../PropertyGridRow'
import WorkingIndicator from '../parts/WorkingIndicator'
import StoredGoodsRow from '../storage/StoredGoodsRow'
import ZoneAnchorButton from '../ZoneAnchorButton'
import AlveolusProperties from './AlveolusProperties'
import DwellingProperties from './DwellingProperties'
import SettlementProperties from './SettlementProperties'
import TileWorkProperties from './TileWorkProperties'
import UnBuiltProperties from './UnBuiltProperties'
import VariantPicker, { type VariantOption, variantDisplayLabel } from './VariantPicker'

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
    padding: 0.55rem;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--ak-text-muted) 16%, transparent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--ak-surface-panel) 88%, transparent);
  }

  .tile-properties__identity {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .tile-properties__identity .working-indicator {
    width: 2rem;
    height: 2rem;
  }

  .tile-properties__identity .working-indicator .gear-icon {
    width: 1.2rem;
    height: 1.2rem;
    font-size: 1.2rem;
  }

  .tile-properties__header-actions {
    display: flex;
    gap: 0.35rem;
    flex: none;
    margin-inline-start: auto;
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--ak-text-muted) 14%, transparent);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--ak-surface-1) 88%, transparent);
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

const resolveTileTerrain = (tile: Tile | undefined): string => {
	if (!tile) return 'grass'
	return tile.terrainState?.terrain ?? tile.baseTerrain ?? 'grass'
}

type TileGame = Tile['board']['game']

type TileContentCase =
	| {
			kind: 'alveolus'
			content: Alveolus
			visualType?: keyof typeof visualAlveoli
			variant?: string
	  }
	| {
			kind: 'basicDwelling'
			content: BasicDwelling
	  }
	| {
			kind: 'buildDwelling'
			content: BuildDwelling
	  }
	| {
			kind: 'constructionShell'
			content: TileContent
			visualType?: keyof typeof visualAlveoli
			variant?: string
	  }
	| {
			kind: 'unbuilt'
			content: UnBuiltLand
	  }
	| {
			kind: 'shop'
			content: Shop
	  }
	| {
			kind: 'other'
			content: TileContent
	  }

const tileContentCase = (content: Tile['content']): TileContentCase | undefined => {
	if (!content) return
	if (content instanceof BuildAlveolus) {
		return {
			kind: 'constructionShell',
			content,
			visualType: content.target as keyof typeof visualAlveoli,
			variant: content.variant,
		}
	}
	if (isConstructionSiteShell(content)) {
		return {
			kind: 'constructionShell',
			content,
			visualType:
				content.constructionSite.target.kind === 'alveolus'
					? (content.constructionSite.target.alveolusType as keyof typeof visualAlveoli)
					: undefined,
			variant:
				content.constructionSite.target.kind === 'alveolus'
					? content.constructionSite.target.variant
					: undefined,
		}
	}
	if (content instanceof Alveolus) {
		return {
			kind: 'alveolus',
			content,
			visualType: content.name as keyof typeof visualAlveoli | undefined,
			variant: content.variant,
		}
	}
	if (content instanceof BasicDwelling) {
		return {
			kind: 'basicDwelling',
			content,
		}
	}
	if (content instanceof BuildDwelling) {
		return {
			kind: 'buildDwelling',
			content,
		}
	}
	if (content instanceof UnBuiltLand) {
		return {
			kind: 'unbuilt',
			content,
		}
	}
	if (content instanceof Shop) {
		return {
			kind: 'shop',
			content,
		}
	}
	return {
		kind: 'other',
		content,
	}
}

const resolveTileTerrainForContentCase = (
	tile: Tile | undefined,
	contentCase: TileContentCase
): string => {
	const terrain = resolveTileTerrain(tile)
	if (
		(contentCase.kind === 'alveolus' || contentCase.kind === 'constructionShell') &&
		terrain === 'grass'
	) {
		// Backward-compatible inspector fallback for older states where alveolus tiles
		// were concrete visually but no explicit terrain patch was persisted.
		return 'concrete'
	}
	return terrain
}

const transformWorkingWarnings = (content: TransformAlveolus): string[] => {
	return transformStallReasons(content).map(
		(reason) => String(T.alveolus.workingWarnings[reason])
	)
}

const formatTileBlockingEntry = (entry: TileBlockingEntry): string => {
	switch (entry.kind) {
		case 'deposit':
			return String(
				T.alveolus.workingWarnings.blockingDeposit({
					type: entry.depositType,
					amount: entry.amount,
				})
			)
		case 'loose-good':
			return String(
				T.alveolus.workingWarnings.blockingLooseGood({
					goodType: entry.goodType,
					count: entry.count,
				})
			)
		case 'vehicle':
			return String(
				T.alveolus.workingWarnings.blockingVehicle({
					label: entry.vehicle.title,
					type: entry.vehicleType,
				})
			)
	}
}

const tileBlockingWarnings = (tile: Tile): string[] => {
	try {
		return queryTileBlocking(tile).map(formatTileBlockingEntry)
	} catch {
		return []
	}
}

const workingWarnings = (tile: Tile, contentCase?: TileContentCase): string[] => {
	const blocking = tileBlockingWarnings(tile)
	if (blocking.length > 0) return blocking
	if (tile.isBurdened) return [String(T.alveolus.workingWarnings.tileBurdened)]
	const content = contentCase?.content
	if (content instanceof TransformAlveolus) return transformWorkingWarnings(content)
	return []
}

const workingWarning = (tile: Tile, contentCase?: TileContentCase): string | undefined => {
	const warnings = workingWarnings(tile, contentCase)
	return warnings.length > 0 ? warnings[0] : undefined
}

interface TileContentHeaderProps {
	contentCase?: TileContentCase
	game?: TileGame
	tile: Tile
}

const TileContentHeader = (props: TileContentHeaderProps) => (
	<>
		<AlveolusTileHeader
			if={props.contentCase?.kind === 'alveolus' || props.contentCase?.kind === 'constructionShell'}
			contentCase={
				props.contentCase as Extract<TileContentCase, { kind: 'alveolus' | 'constructionShell' }>
			}
			game={props.game}
			tile={props.tile}
		/>
		<BasicDwellingTileHeader
			else
			if={props.contentCase?.kind === 'basicDwelling'}
			contentCase={props.contentCase as Extract<TileContentCase, { kind: 'basicDwelling' }>}
			game={props.game}
			tile={props.tile}
		/>
		<ShopTileHeader
			else
			if={props.contentCase?.kind === 'shop'}
			contentCase={props.contentCase as Extract<TileContentCase, { kind: 'shop' }>}
			game={props.game}
			tile={props.tile}
		/>
		<TileZoneHeaderFallback
			else
			if={!!customZoneTitle(props.tile)}
			game={props.game}
			tile={props.tile}
		/>
	</>
)

function customZoneTitle(tile: Tile): string | undefined {
	const zone = tile.zone
	return zone ? zone.name?.trim() || undefined : undefined
}

function shopDisplayLabel(shopType: string): string {
	return shopType
		.split('_')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

const TileZoneHeaderFallback = (props: { game?: TileGame; tile: Tile }) => {
	const title = () => customZoneTitle(props.tile)
	return (
		<div class="tile-properties__header">
			<div class="tile-properties__identity" />
			<div class="tile-properties__header-actions">
				<ZoneAnchorButton if={title()} tile={props.tile} title={title()} />
			</div>
		</div>
	)
}

function collectVariantOptions(alveolusType: string): VariantOption[] {
	const def = (gameContent.alveoli as any)[alveolusType]
	if (!def || !def.variants) return []
	const options: VariantOption[] = []
	const walk = (prefix: string, variants: Record<string, any>) => {
		for (const [key, vdef] of Object.entries(variants)) {
			const fullId = prefix ? `${prefix}.${key}` : key
			const badgeKey = `${alveolusType}.${fullId}`
			const badgeSprite = variantBadges[badgeKey]?.sprites?.[0]
			const label = variantDisplayLabel(key)
			options.push({ value: fullId, label, badgeSprite })
			if (vdef.variants) walk(fullId, vdef.variants)
		}
	}
	walk('', def.variants)
	return options
}

interface AlveolusTileHeaderProps {
	contentCase?: Extract<TileContentCase, { kind: 'alveolus' | 'constructionShell' }>
	game?: TileGame
	tile: Tile
}

const AlveolusTileHeader = (props: AlveolusTileHeaderProps) => {
	const model = {
		get contentCase() {
			return props.contentCase
		},
		get visual() {
			const contentCase = this.contentCase
			return contentCase?.visualType ? visualAlveoli[contentCase.visualType] : undefined
		},
		get sprite() {
			return this.visual?.sprites?.[0]
		},
		get title() {
			const contentCase = this.contentCase
			if (!contentCase) return ''
			return contentCase.visualType
				? String(T.alveoli[contentCase.visualType])
				: contentCase.content.title
		},
		get visualType() {
			return this.contentCase?.visualType
		},
		get variantOptions() {
			const all = this.visualType ? collectVariantOptions(this.visualType as string) : []
			const current = this.currentVariant
			if (!current) return all
			// Filter out pure degradation: ancestors of the current variant
			// and the current variant itself (no-op).
			const isAncestor = (optValue: string) =>
				optValue !== '' && (current === optValue || current.startsWith(`${optValue}.`))
			return all.filter((opt) => !isAncestor(opt.value))
		},
		get hasVariants() {
			return this.variantOptions.length > 0
		},
		get currentVariant() {
			// contentCase is computed by tileContentCase() which reads .variant
			// directly from the Alveolus instance — bypasses @unreactive proxy
			return props.contentCase?.variant ?? ''
		},
		get hiveTitle() {
			return this.contentCase?.content.hive?.name?.trim() || 'Hive'
		},
		get siteProject() {
			const content = this.contentCase?.content as { project?: unknown } | undefined
			return (content?.project ?? undefined) as
				| import('ssh/project').Project
				| undefined
		},
		get siteProjectTitle() {
			return this.siteProject?.name?.trim() || 'Project'
		},
		get zoneTitle() {
			return customZoneTitle(props.tile)
		},
		get workingWarning() {
			return workingWarning(props.tile, this.contentCase)
		},
		get workingWarnings() {
			return workingWarnings(props.tile, this.contentCase)
		},
	}

	return (
		<>
			<div
				if={props.game && model.contentCase && (model.contentCase.visualType || model.sprite)}
				class="tile-properties__header"
			>
			<div class="tile-properties__identity">
				<EntityBadge
					game={props.game!}
					sprite={model.sprite ?? ''}
					text={model.title ?? ''}
					height={32}
				/>
				<VariantPicker
					if={model.hasVariants}
					options={model.variantOptions}
					value={model.currentVariant}
					hideRoot={!!model.currentVariant}
					typeKey={model.visualType as string}
					onChange={(newValue) => {
						const alveolusType = model.contentCase?.visualType
						if (!alveolusType) return
						props.game?.changeAlveolusVariant(
							props.tile,
							alveolusType as AlveolusType,
							newValue || undefined
						)
					}}
				/>
				<WorkingIndicator
					checked={model.contentCase!.content.working}
					burdened={!!model.workingWarning}
					tooltip={T.alveolus.workingTooltip}
					warning={model.workingWarnings.join('\n')}
				/>
			</div>
			<div class="tile-properties__header-actions">
				<ZoneAnchorButton if={model.zoneTitle} tile={props.tile} title={model.zoneTitle} />
				<HiveAnchorButton tile={props.tile} title={model.hiveTitle} />
				<ProjectAnchorButton
					if={model.siteProject}
					project={model.siteProject}
					tile={props.tile}
					title={model.siteProjectTitle}
				/>
			</div>
			</div>
			<div
				if={props.game && model.contentCase && model.workingWarnings.length > 1}
				class="tile-properties__header"
				data-testid="tile-blocking-list"
			>
				<div style="display:grid; gap:0.25rem; width:100%;">
					<for each={model.workingWarnings}>
						{(text) => (
							<span data-testid="tile-blocking-entry" style="color: var(--ak-text-muted)">
								· {text}
							</span>
						)}
					</for>
				</div>
			</div>
		</>
	)
}

interface BasicDwellingTileHeaderProps {
	contentCase: Extract<TileContentCase, { kind: 'basicDwelling' }>
	game?: TileGame
	tile: Tile
}

const BasicDwellingTileHeader = (props: BasicDwellingTileHeaderProps) => {
	const model = {
		get visual() {
			return visualDwellings.basic_dwelling
		},
		get sprite() {
			return this.visual?.sprites?.[0]
		},
		get zoneTitle() {
			return customZoneTitle(props.tile)
		},
	}

	return (
		<div if={props.game && model.sprite} class="tile-properties__header">
			<div class="tile-properties__identity">
				<EntityBadge
					game={props.game!}
					sprite={model.sprite ?? ''}
					text={String(T.residential.dwelling.tierBasic)}
					height={32}
				/>
			</div>
			<div if={model.zoneTitle} class="tile-properties__header-actions">
				<ZoneAnchorButton tile={props.tile} title={model.zoneTitle} />
			</div>
		</div>
	)
}

interface ShopTileHeaderProps {
	contentCase: Extract<TileContentCase, { kind: 'shop' }>
	game?: TileGame
	tile: Tile
}

const ShopTileHeader = (props: ShopTileHeaderProps) => {
	const model = {
		get sprite() {
			return visualDwellings.shop?.sprites?.[0]
		},
		get label() {
			return shopDisplayLabel(props.contentCase.content.shopType)
		},
		get zoneTitle() {
			return customZoneTitle(props.tile)
		},
	}

	return (
		<div if={props.game && model.sprite} class="tile-properties__header">
			<div class="tile-properties__identity">
				<EntityBadge
					game={props.game!}
					sprite={model.sprite ?? ''}
					text={model.label}
					height={32}
				/>
			</div>
			<div if={model.zoneTitle} class="tile-properties__header-actions">
				<ZoneAnchorButton tile={props.tile} title={model.zoneTitle} />
			</div>
		</div>
	)
}

interface ZoneRowProps {
	tile: Tile
}

const ZoneRow = (props: ZoneRowProps) => {
	const model = {
		get tone() {
			return props.tile.zone?.type === 'residential' ? 'green' : 'yellow'
		},
		get label() {
			const zone = props.tile.zone
			if (!zone) return ''
			return zone.name?.trim() || null
		},
	}

	return (
		<PropertyGridRow if={props.tile.zone} label={T.tile.zone}>
			<Badge tone={model.tone}>{model.label}</Badge>
		</PropertyGridRow>
	)
}

interface WalkTimeRowProps {
	content?: TileContent
}

const WalkTimeRow = (props: WalkTimeRowProps) => {
	const model = {
		get isUnwalkable() {
			return props.content?.walkTime === Number.POSITIVE_INFINITY
		},
		get tone() {
			return this.isUnwalkable ? 'red' : 'yellow'
		},
		get label() {
			if (this.isUnwalkable) return T.tile.unwalkable
			return props.content?.walkTime
		},
	}

	return (
		<PropertyGridRow label={T.tile.walkTime}>
			<Badge tone={model.tone}>{model.label}</Badge>
		</PropertyGridRow>
	)
}

interface GenericStoredGoodsRowProps {
	game?: TileGame
	show?: boolean
	stock?: Record<string, number>
	storedGoods: GoodType[]
}

const GenericStoredGoodsRow = (props: GenericStoredGoodsRowProps) => (
	<PropertyGridRow if={props.show && props.game} label={T.goods.stored}>
		<GoodsList
			goods={props.storedGoods}
			game={props.game!}
			getBadgeProps={(g) => ({ qty: props.stock?.[g] ?? 0 })}
		/>
	</PropertyGridRow>
)

interface LooseGoodsRowProps {
	freeStock: Record<string, number>
	game?: TileGame
	looseGoods: GoodType[]
	show?: boolean
}

const LooseGoodsRow = (props: LooseGoodsRowProps) => (
	<PropertyGridRow if={props.show && props.game} label={T.goods.loose}>
		<GoodsList
			goods={props.looseGoods}
			game={props.game!}
			getBadgeProps={(g) => ({ qty: props.freeStock[g] })}
		/>
	</PropertyGridRow>
)

interface TileContentDetailsProps {
	contentCase?: TileContentCase
	game?: TileGame
	tile: Tile
}

const TileContentDetails = (props: TileContentDetailsProps) => (
	<>
		<BuildDwellingTileDetails
			if={
				props.contentCase?.kind === 'buildDwelling' ||
				props.contentCase?.kind === 'constructionShell'
			}
			content={props.contentCase?.content as TileContent}
			game={props.game}
			tile={props.tile}
		/>
		<BasicDwellingTileDetails
			else
			if={props.contentCase?.kind === 'basicDwelling'}
			content={props.contentCase?.content as BasicDwelling}
			game={props.game}
		/>
		<AlveolusProperties
			else
			if={props.contentCase?.kind === 'alveolus'}
			content={props.contentCase?.content as Alveolus}
			game={props.game}
		/>
		<ShopTileDetails
			else
			if={props.contentCase?.kind === 'shop'}
			content={props.contentCase?.content as Shop}
			game={props.game}
		/>
		<UnBuiltProperties
			else
			if={props.contentCase?.kind === 'unbuilt'}
			content={props.contentCase?.content as UnBuiltLand}
		/>
	</>
)

interface ShopTileDetailsProps {
	content: Shop
	game?: TileGame
}

const ShopTileDetails = (props: ShopTileDetailsProps) => {
	const stock = () => props.content.storage.stock as Record<string, number>
	const storedGoods = () => Object.keys(stock()) as GoodType[]

	return (
		<PropertyGrid>
			<PropertyGridRow label="Shop type">
				<Badge tone="blue">{shopDisplayLabel(props.content.shopType)}</Badge>
			</PropertyGridRow>
			<GenericStoredGoodsRow
				game={props.game}
				show={storedGoods().length > 0}
				stock={stock()}
				storedGoods={storedGoods()}
			/>
		</PropertyGrid>
	)
}

interface BuildDwellingTileDetailsProps {
	content: TileContent
	game?: TileGame
	tile: Tile
}

const emptyConstruction = {
	show: false,
	phaseLabel: '',
	blocking: [] as string[],
	workLine: '',
	applied: 0,
	total: 0,
	targetDisplay: '',
}

const BuildDwellingTileDetails = (props: BuildDwellingTileDetailsProps) => {
	const model = {
		get dwellingConstruction() {
			if (!props.game) return emptyConstruction
			const snap = queryConstructionSiteView(props.game, props.tile)
			if (!snap) return emptyConstruction
			const construction = buildConstructionViewModel(snap, T as ConstructionTranslatorShape)
			return {
				show: true,
				phaseLabel: construction.phaseLabel,
				blocking: construction.blockingLabels,
				workLine: construction.workLine,
				applied: construction.applied,
				total: construction.total,
				targetDisplay: construction.targetDisplay,
			}
		},
	}

	return (
		<>
			<PropertyGridRow if={model.dwellingConstruction.show} label={String(T.construction.section)}>
				<div style="display:grid; gap:0.5rem; width:100%;">
					<div style="display:flex; flex-wrap:wrap; gap:0.25rem; align-items:center;">
						<span>{model.dwellingConstruction.phaseLabel}</span>{' '}
						<span
							if={model.dwellingConstruction.targetDisplay.length > 0}
							style="color: var(--ak-accent, #8b5cf6);"
						>
							· {model.dwellingConstruction.targetDisplay}
						</span>{' '}
						<for each={model.dwellingConstruction.blocking}>
							{(text) => <span style="color: var(--ak-text-muted)"> · {text}</span>}
						</for>
					</div>
					<ConstructionProgressBar
						if={model.dwellingConstruction.total > 0}
						applied={model.dwellingConstruction.applied}
						total={model.dwellingConstruction.total}
						label={model.dwellingConstruction.workLine}
						testId="dwelling-construction-progress"
					/>
				</div>
			</PropertyGridRow>
			<StoredGoodsRow
				if={props.game}
				content={props.content as never}
				game={props.game!}
				label={T.construction.materials}
			/>
		</>
	)
}

interface BasicDwellingTileDetailsProps {
	content: BasicDwelling
	game?: TileGame
}

const BasicDwellingTileDetails = (props: BasicDwellingTileDetailsProps) => (
	<>
		<StoredGoodsRow
			if={props.game}
			content={props.content}
			game={props.game!}
			label={T.goods.stored}
		/>
		<DwellingProperties content={props.content} />
	</>
)

const TileProperties = (props: TilePropertiesProps) => {
	const tile = lazy(() => props.tile)
	const model = {
		get contentCase() {
			return tileContentCase(tile.content)
		},
		get content() {
			return this.contentCase?.content
		},
		get game() {
			return props.tile.board?.game
		},
		get settlementTradeProfile() {
			const position = props.tile.position
			if (
				!position ||
				typeof (position as { q?: unknown }).q !== 'number' ||
				typeof (position as { r?: unknown }).r !== 'number'
			) {
				return undefined
			}
			const coord = toAxialCoord(position)
			if (!coord) return undefined
			return this.game?.getSettlementTradeProfileAtCityHall?.(coord)
		},
		get contentTerrain() {
			const contentCase = this.contentCase
			if (!contentCase) return undefined
			if (contentCase.kind === 'unbuilt') return contentCase.content.terrain
			return resolveTileTerrainForContentCase(tile, contentCase)
		},
		get stock() {
			return this.content?.storage?.stock
		},
		get storedGoods() {
			return Object.keys(this.stock ?? {}) as GoodType[]
		},
		get freeStock() {
			const counts: Record<string, number> = {}
			for (const fg of tile.looseGoods ?? []) {
				if (!fg.available) continue
				counts[fg.goodType] = (counts[fg.goodType] ?? 0) + 1
			}
			return counts
		},
		get looseGoods() {
			return Object.keys(this.freeStock) as GoodType[]
		},
		get showGenericStoredGoods() {
			if (this.storedGoods.length <= 0) return false
			return this.contentCase?.kind === 'other' || this.contentCase?.kind === 'unbuilt'
		},
		get rootClass() {
			if (state.terrainBackgroundStyle) return 'tile-properties has-terrain'
			return 'tile-properties'
		},
	}
	const state = reactive({
		terrainBackgroundStyle: '',
	})

	effect`tile-properties:terrain-bg`(() => {
		if (model.contentTerrain) {
			void (async () => {
				const currentGame = model.game
				if (!currentGame) {
					state.terrainBackgroundStyle = ''
					return
				}
				await currentGame.loaded
				if (model.game !== currentGame) return
				const texture = currentGame.getTexture(`terrain.${model.contentTerrain}`)
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
		<div if={model.content} class={model.rootClass} style={state.terrainBackgroundStyle}>
			<TileContentHeader contentCase={model.contentCase} game={model.game} tile={tile} />

			<InspectorSection class="tile-properties__content">
				<PropertyGrid>
					<ZoneRow if={model.contentCase?.kind !== 'unbuilt'} tile={tile} />
					<WalkTimeRow content={model.content} />
					<GenericStoredGoodsRow
						show={model.showGenericStoredGoods}
						storedGoods={model.storedGoods}
						stock={model.stock}
						game={model.game}
					/>
					<TileContentDetails contentCase={model.contentCase} game={model.game} tile={tile} />
					<LooseGoodsRow
						show={model.looseGoods.length > 0}
						looseGoods={model.looseGoods}
						freeStock={model.freeStock}
						game={model.game}
					/>
				</PropertyGrid>
			</InspectorSection>
			<SettlementProperties
				if={model.settlementTradeProfile}
				profile={model.settlementTradeProfile}
			/>
			<TileWorkProperties tile={tile} />
		</div>
	)
}

export default TileProperties
