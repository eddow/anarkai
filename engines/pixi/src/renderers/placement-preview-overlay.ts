import { alveoli, variantBadges } from 'engine-rules/visual-content'
import { Container, Graphics, Point, Sprite, Texture } from 'pixi.js'
import { type RoadPreviewEntry, roadBorderEndpointCoords } from 'ssh/board/roads'
import type { AlveolusType } from 'ssh/types/base'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'

/**
 * One alveolus to ghost onto the board during authoring/preview. Coords are
 * absolute board coordinates.
 */
export interface PlacementPreviewEntry {
	coord: readonly [number, number]
	/** Building sprite to ghost; omit for walled-in victim markers (highlight only, no sprite). */
	alveolusType?: AlveolusType
	variant?: string
	/** Non-empty when this tile collides (water, existing alveolus, other project, …). Red. */
	blocked?: string
	/** Non-empty when this pending tile is refused without collision (deadlock/partition). Pinkish via pending-invalid. */
	invalid?: string
	/** Non-empty when this tile is a walled-in victim of the pending placement. Dark purple. */
	inaccessible?: string
	/** true = pending (hover) placement; false/undefined = already-placed project footprint. */
	pending?: boolean
}

const PREVIEW_ALPHA = 0.45
/** Valid "under construction" footprint (blue). */
const VALID_BLUE = { fill: 0x44aaff, stroke: 0x2288dd }
/** Colliding tile (dark red/orange). */
const COLLISION = { fill: 0xd95858, stroke: 0x9b1d24 }
/** Walled-in victim tile (dark purple) — the `lockedTiles` / walled neighbours beside the footprint, or the whole footprint when completely locked. */
const INACCESSIBLE = { fill: 0x8b5cf6, stroke: 0x4c1d95 }
/** Whole pending placement invalid filigree (pinkish-red). */
const PINKISH = { fill: 0xff9a9a, stroke: 0xe0557a }
/** Sprite tint when the tile collides. */
const BLOCKED_TINT = 0xd95858
/** Sprite tint when a pending placement is invalid but this tile is not the culprit. */
const INVALID_TINT = 0xffb4d9
/** Bulldozing footprint (orange) — a tile planned for demolition. */
const DEMOLITION = { fill: 0xd97706, stroke: 0xb45309 }

function usableTexture(texture: Texture | undefined): Texture | null {
	if (!texture || texture === Texture.WHITE) return null
	const frame = texture.frame
	return frame.width > 0 && frame.height > 0 ? texture : null
}

/**
 * Semi-transparent building ghosts for project authoring: renders each
 * `PlacementPreviewEntry` as a faded building sprite (plus variant badge) and
 * each `RoadPreviewEntry` as a road line, in world space. A footprint is drawn
 * under every implied tile: **blue** for already-placed (persistent) footprints,
 * **dark red/orange** on colliding tiles (`blocked`), **dark purple** on `inaccessible`
 * tiles (the `lockedTiles` / walled neighbours, or the whole footprint when completely
 * locked), and **pinkish-red** across a *pending* placement when it is invalid (an `invalid`
 * connectivity refusal, or any blocked/inaccessible tile in the placement). Persistent project footprints never tint
 * red — only the cursor's pending placement does.
 */
export class PlacementPreviewOverlay {
	private container: Container
	private graphics: Graphics
	private sprites: Sprite[] = []
	private cleanups: (() => void)[] = []

	constructor(private renderer: PixiGameRenderer) {
		const scope = 'overlay:placementPreview'
		this.container = setPixiName(new Container(), scope)
		this.graphics = setPixiName(new Graphics(), scopedPixiName(scope, 'graphics'))
		this.container.addChild(this.graphics)
		this.renderer.world?.addChild(this.container)
		this.container.zIndex = 99 // Above tiles, below the drag-preview highlight
	}

	public bind() {
		const game = this.renderer.game

		const onPreview = (
			entries: PlacementPreviewEntry[],
			roads?: RoadPreviewEntry[],
			demolitions?: ReadonlyArray<readonly [number, number]>
		) => {
			this.show(entries, roads ?? [], demolitions ?? [])
		}
		const onClear = () => this.clear()

		game.on({
			placementPreview: onPreview,
			placementPreviewClear: onClear,
		})

		this.cleanups.push(() => {
			game.off({
				placementPreview: onPreview,
				placementPreviewClear: onClear,
			})
		})
	}

	private clear() {
		this.graphics.clear()
		for (const sprite of this.sprites) sprite.destroy()
		this.sprites = []
	}

	private drawTileHighlight(
		coord: readonly [number, number],
		colors: { fill: number; stroke: number },
		alpha: number
	) {
		const worldPos = toWorldCoord({ q: coord[0], r: coord[1] })
		if (!worldPos) return
		const points = Array.from({ length: 6 }, (_, i) => {
			const angle = (Math.PI / 3) * (i + 0.5)
			return new Point(
				worldPos.x + Math.cos(angle) * (tileSize - 2),
				worldPos.y + Math.sin(angle) * (tileSize - 2)
			)
		})
		this.graphics.poly(points).fill({ color: colors.fill, alpha: alpha * 0.32 })
		this.graphics.poly(points).stroke({ width: 2, color: colors.stroke, alpha: alpha * 0.85 })
	}

	private drawRoad(road: RoadPreviewEntry) {
		const [a, b] = roadBorderEndpointCoords(road.coord)
		const wa = toWorldCoord({ q: a[0], r: a[1] })
		const wb = toWorldCoord({ q: b[0], r: b[1] })
		if (!wa || !wb) return
		const colors = road.blocked ? COLLISION : VALID_BLUE
		this.graphics.moveTo(wa.x, wa.y)
		this.graphics.lineTo(wb.x, wb.y)
		this.graphics.stroke({
			width: tileSize * 0.22,
			color: colors.stroke,
			alpha: 0.9,
			cap: 'round',
			join: 'round',
		})
	}

	private show(
		entries: readonly PlacementPreviewEntry[],
		roads: readonly RoadPreviewEntry[],
		demolitions: ReadonlyArray<readonly [number, number]>
	) {
		this.clear()

		// Demolition footprints (orange) first, beneath building ghosts.
		for (const coord of demolitions) this.drawTileHighlight(coord, DEMOLITION, 1)

		// Roads (lines) next.
		for (const road of roads) this.drawRoad(road)

		// Pending (hover) validity only affects pending footprints. `blocked` (red =
		// conflictual) and `invalid` (connectivity refusal, pinkish via pending-invalid)
		// both invalidate; `inaccessible` victim markers (purple, beside the footprint)
		// invalidate too.
		const pending = entries.filter((entry) => entry.pending)
		const pendingValid = pending.every(
			(entry) => !entry.blocked && !entry.invalid && !entry.inaccessible
		)

		const seen = new Set<string>()
		for (const entry of entries) {
			const key = `${entry.coord[0]},${entry.coord[1]}`
			if (seen.has(key)) continue
			seen.add(key)
			const colors = entry.blocked
				? COLLISION
				: entry.inaccessible
					? INACCESSIBLE
					: entry.pending && !pendingValid
						? PINKISH
						: VALID_BLUE
			this.drawTileHighlight(entry.coord, colors, 1)
		}

		for (const entry of entries) {
			const world = toWorldCoord({ q: entry.coord[0], r: entry.coord[1] })
			if (!world) continue

			const visualDef = entry.alveolusType
				? alveoli[entry.alveolusType as keyof typeof alveoli]
				: undefined
			const textureName = visualDef?.sprites?.[0]
			const tex = textureName ? usableTexture(this.renderer.getTexture(textureName)) : null
			if (!tex) continue

			const blocked = !!entry.blocked || !!entry.inaccessible
			const invalidPending = !blocked && !!entry.pending && !pendingValid
			const sprite = setPixiName(new Sprite(tex), 'placementPreview:sprite')
			sprite.anchor.set(0.5)
			sprite.position.set(world.x, world.y)
			sprite.alpha = blocked ? 0.3 : invalidPending ? 0.35 : PREVIEW_ALPHA
			sprite.tint = entry.blocked
				? BLOCKED_TINT
				: entry.inaccessible
					? 0x8b5cf6
					: invalidPending
						? INVALID_TINT
						: 0xffffff
			const maxDim = Math.max(tex.width, tex.height)
			if (maxDim > 1) {
				const scale = (tileSize * (9 / 8)) / maxDim
				sprite.scale.set(scale)
			}
			this.container.addChild(sprite)
			this.sprites.push(sprite)

			// Variant badge overlay.
			if (entry.variant) {
				const badgeKey = `${entry.alveolusType}.${entry.variant}` as keyof typeof variantBadges
				const badgeDef = badgeKey in variantBadges ? variantBadges[badgeKey] : undefined
				const badgeTexName = badgeDef?.sprites?.[0]
				const badgeTex = badgeTexName ? usableTexture(this.renderer.getTexture(badgeTexName)) : null
				if (badgeTex) {
					const badge = setPixiName(new Sprite(badgeTex), 'placementPreview:variant-badge')
					badge.anchor.set(1, 0)
					const badgeSize = tileSize * 0.42
					const badgeMaxDim = Math.max(badgeTex.width, badgeTex.height)
					if (badgeMaxDim > 1) badge.scale.set(badgeSize / badgeMaxDim)
					badge.x = world.x + tileSize * 0.5
					badge.y = world.y - tileSize * 0.5
					badge.alpha = sprite.alpha
					badge.tint = sprite.tint
					this.container.addChild(badge)
					this.sprites.push(badge)
				}
			}
		}
	}

	public dispose() {
		this.cleanups.forEach((c) => c())
		this.clear()
		this.container.destroy({ children: true })
	}
}
