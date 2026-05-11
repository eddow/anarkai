import { freightLineOverlay, zoneOverlayState } from '@app/lib/freight-line-overlay'
import { effect } from 'mutts'
import { Container, Graphics, Point } from 'pixi.js'
import { Alveolus } from 'ssh/board/content/alveolus'
import { Tile } from 'ssh/board/tile'
import {
	findFreightLineById,
	freightZoneFallbackPosition,
	freightZoneTiles,
	type FreightStop,
} from 'ssh/freight/freight-line'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'

function parseColor(value: string | undefined, fallback: number): number {
	if (!value) return fallback
	const parsed = Number.parseInt(value.replace(/^#/, ''), 16)
	return Number.isFinite(parsed) ? parsed : fallback
}

function hexPoints(x: number, y: number, inset = 2): Point[] {
	const size = tileSize - inset
	return Array.from(
		{ length: 6 },
		(_, i) =>
			new Point(x + Math.cos((Math.PI / 3) * (i + 0.5)) * size, y + Math.sin((Math.PI / 3) * (i + 0.5)) * size)
	)
}

export class FreightLineOverlay {
	private readonly container: Container
	private readonly graphics: Graphics
	private cleanup?: () => void

	constructor(private readonly renderer: PixiGameRenderer) {
		const scope = 'overlay:freightLine'
		this.container = setPixiName(new Container(), scope)
		this.graphics = setPixiName(new Graphics(), scopedPixiName(scope, 'graphics'))
		this.container.addChild(this.graphics)
		this.container.zIndex = 6
		this.renderer.world?.addChild(this.container)
	}

	bind(): void {
		this.cleanup = effect`freight-line-overlay:render`(() => {
			this.render()
		})
	}

	private stopRepresentative(stop: FreightStop): { x: number; y: number } | undefined {
		if ('anchor' in stop) {
			const world = toWorldCoord({ q: stop.anchor.coord[0], r: stop.anchor.coord[1] })
			return world ?? undefined
		}
		if (stop.zone.kind === 'radius') {
			const world = toWorldCoord({ q: stop.zone.center[0], r: stop.zone.center[1] })
			return world ?? undefined
		}
		const coord = freightZoneFallbackPosition(this.renderer.game, stop.zone)
		return coord ? (toWorldCoord(coord) ?? undefined) : undefined
	}

	private drawStop(stop: FreightStop, color: number, emphasized: boolean): void {
		const alpha = emphasized ? 0.32 : 0.16
		const strokeWidth = emphasized ? 3.5 : 2
		if ('zone' in stop && stop.zone.kind === 'named') {
			for (const tile of freightZoneTiles(this.renderer.game, stop.zone)) {
				const world = toWorldCoord(tile.position)
				if (!world) continue
				const zoneColor = emphasized
					? color
					: parseColor(this.renderer.game.hex.zoneManager.getZoneDefinition(stop.zone.zoneId)?.color, color)
				const points = hexPoints(world.x, world.y, emphasized ? 0 : 2)
				this.graphics.poly(points).fill({ color: zoneColor, alpha })
				this.graphics.poly(points).stroke({ width: strokeWidth, color: zoneColor, alpha: 0.9 })
			}
			return
		}
		const world = this.stopRepresentative(stop)
		if (!world) return
		if ('zone' in stop && stop.zone.kind === 'radius') {
			this.graphics.circle(world.x, world.y, Math.max(tileSize, stop.zone.radius * tileSize * 1.55))
			this.graphics.fill({ color, alpha: emphasized ? 0.16 : 0.08 })
			this.graphics.circle(world.x, world.y, Math.max(tileSize, stop.zone.radius * tileSize * 1.55))
			this.graphics.stroke({ width: strokeWidth, color, alpha: 0.75 })
		}
		const points = hexPoints(world.x, world.y, emphasized ? 0 : 3)
		this.graphics.poly(points).fill({ color, alpha })
		this.graphics.poly(points).stroke({ width: strokeWidth, color, alpha: 0.95 })
	}

	private drawNamedZone(zoneId: string, emphasized: boolean): void {
		const definition = this.renderer.game.hex.zoneManager.getZoneDefinition(zoneId)
		if (!definition) return
		const color = parseColor(definition.color, 0x4f8cff)
		const alpha = emphasized ? 0.28 : 0.14
		for (const coord of this.renderer.game.hex.zoneManager.coordsForZone(zoneId)) {
			const world = toWorldCoord(coord)
			if (!world) continue
			const points = hexPoints(world.x, world.y, emphasized ? 0 : 2)
			this.graphics.poly(points).fill({ color, alpha })
			this.graphics.poly(points).stroke({
				width: emphasized ? 3 : 1.5,
				color,
				alpha: emphasized ? 0.85 : 0.42,
			})
		}
	}

	private drawHive(anchorTileUid: string): void {
		const tile = this.renderer.game.objects.get(anchorTileUid)
		if (!(tile instanceof Tile) || !(tile.content instanceof Alveolus)) return
		const hive = tile.content.hive
		const color = 0xffd84d
		for (const candidate of this.renderer.game.hex.tiles) {
			if (!(candidate.content instanceof Alveolus) || candidate.content.hive !== hive) continue
			const world = toWorldCoord(candidate.position)
			if (!world) continue
			const points = hexPoints(world.x, world.y, 0)
			this.graphics.poly(points).fill({ color, alpha: 0.22 })
			this.graphics.poly(points).stroke({ width: 2.5, color, alpha: 0.72 })
		}
	}

	private render(): void {
		this.graphics.clear()
		if (zoneOverlayState.hoveredHiveAnchorTileUid) {
			this.drawHive(zoneOverlayState.hoveredHiveAnchorTileUid)
		}
		if (zoneOverlayState.selectedZoneId) {
			this.drawNamedZone(zoneOverlayState.selectedZoneId, true)
		}
		if (
			zoneOverlayState.hoveredZoneId &&
			zoneOverlayState.hoveredZoneId !== zoneOverlayState.selectedZoneId
		) {
			this.drawNamedZone(zoneOverlayState.hoveredZoneId, true)
		}
		const lineId = freightLineOverlay.lineId
		if (!lineId) return
		const line = findFreightLineById(this.renderer.game.freightLines, lineId)
		if (!line) return
		const color = 0x4f8cff
		const reps = line.stops.map((stop) => this.stopRepresentative(stop)).filter(Boolean) as Array<{
			x: number
			y: number
		}>
		if (reps.length > 1) {
			this.graphics.moveTo(reps[0]!.x, reps[0]!.y)
			for (const point of reps.slice(1)) this.graphics.lineTo(point.x, point.y)
			this.graphics.stroke({ width: 4, color, alpha: 0.58 })
			this.graphics.moveTo(reps[0]!.x, reps[0]!.y)
			for (const point of reps.slice(1)) this.graphics.lineTo(point.x, point.y)
			this.graphics.stroke({ width: 1.5, color: 0xffffff, alpha: 0.76 })
		}
		for (const stop of line.stops) {
			this.drawStop(stop, color, stop.id === freightLineOverlay.hoveredStopId)
		}
	}

	dispose(): void {
		this.cleanup?.()
		this.container.destroy({ children: true })
	}
}
