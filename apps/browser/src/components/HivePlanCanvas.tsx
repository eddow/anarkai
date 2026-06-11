import { assetManager } from 'engine-pixi/asset-manager'
import { alveoli as visualAlveoli, variantBadges } from 'engine-pixi/assets/visual-content'
import { effect } from 'mutts'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { HivePlan, HivePlanStructuralIssue } from 'ssh/hive-plan'
import { hivePlanCoordKey, hivePlanEntryAt, hivePlanVisibleCandidateCoords } from 'ssh/hive-plan'
import type { AxialCoord } from 'ssh/utils/axial'

type HivePlanCanvasProps = {
	plan: HivePlan | undefined
	issues: readonly HivePlanStructuralIssue[]
	selectedRoleId?: string
	selectedAction?: string
	readOnly?: boolean
	onHexClick?: (coord: AxialCoord) => void
}

const side = 30
const sqrt3 = Math.sqrt(3)

function axialToPixel(coord: AxialCoord): { x: number; y: number } {
	return {
		x: side * sqrt3 * (coord.q + coord.r / 2),
		y: side * 1.5 * coord.r,
	}
}

function hexPath(cx: number, cy: number): number[] {
	const points: number[] = []
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 180) * (60 * i - 30)
		points.push(cx + side * Math.cos(angle), cy + side * Math.sin(angle))
	}
	return points
}

function issueCoordKeys(issues: readonly HivePlanStructuralIssue[]): Set<string> {
	const keys = new Set<string>()
	for (const issue of issues) {
		if (issue.code === 'disconnected') {
			for (const group of issue.groups ?? []) for (const key of group) keys.add(key)
		}
	}
	return keys
}

function deferPixiDestroy(app: Application, stage: Container | undefined) {
	try {
		app.ticker?.stop()
	} catch (error) {
		console.warn('[HivePlanCanvas] Failed to stop Pixi ticker before destroy.', error)
	}
	app.canvas?.parentElement?.removeChild(app.canvas)
	const destroy = () => {
		try {
			stage?.removeChildren().forEach((child) => child.destroy())
			app.destroy({ removeView: false }, { children: true })
		} catch (error) {
			console.warn('[HivePlanCanvas] Pixi destroy failed after unmount.', error)
		}
	}
	if (typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(() => requestAnimationFrame(destroy))
	} else {
		setTimeout(destroy, 0)
	}
}

const HivePlanCanvas = (props: HivePlanCanvasProps) => {
	let host: HTMLElement | undefined
	let app: Application | undefined
	let stage: Container | undefined
	let resizeObserver: ResizeObserver | undefined
	let mounted = false

	const draw = () => {
		if (!mounted || !app || !stage) return
		stage.removeChildren().forEach((child) => child.destroy())

		const width = app.renderer.width || host?.clientWidth || 420
		const height = app.renderer.height || host?.clientHeight || 320
		const plan = props.plan
		const entries = plan?.entries ?? []
		const candidates = hivePlanVisibleCandidateCoords(entries)
		const coords = [
			...entries.map((entry) => ({ q: entry.coord[0], r: entry.coord[1] })),
			...candidates,
		]
		const pixels = coords.map(axialToPixel)
		const minX = Math.min(...pixels.map((p) => p.x), -side)
		const maxX = Math.max(...pixels.map((p) => p.x), side)
		const minY = Math.min(...pixels.map((p) => p.y), -side)
		const maxY = Math.max(...pixels.map((p) => p.y), side)
		const boundsWidth = Math.max(1, maxX - minX + side * 2)
		const boundsHeight = Math.max(1, maxY - minY + side * 2)
		const scale = Math.min(1.45, (width - 28) / boundsWidth, (height - 28) / boundsHeight)
		const tx = width / 2 - ((minX + maxX) / 2) * scale
		const ty = height / 2 - ((minY + maxY) / 2) * scale
		const badKeys = issueCoordKeys(props.issues)

		const drawHex = (coord: AxialCoord, occupied: boolean) => {
			const key = hivePlanCoordKey(coord)
			const entry = plan ? hivePlanEntryAt(plan.entries, coord) : undefined
			const pixel = axialToPixel(coord)
			const x = pixel.x * scale + tx
			const y = pixel.y * scale + ty
			const selected = entry?.roleId && entry.roleId === props.selectedRoleId
			const bad = badKeys.has(key) || props.issues.some((issue) => issue.roleId === entry?.roleId)
			const fill = occupied ? 0xdbe9d4 : 0xf3f0df
			const line = bad ? 0xc2410c : selected ? 0x2563eb : occupied ? 0x5d7b61 : 0xb7ab83
			const alpha = occupied ? 1 : 0.56

			const hex = new Graphics()
			hex.poly(hexPath(x, y))
			hex.fill({ color: fill, alpha })
			hex.stroke({ color: line, width: selected || bad ? 3 : 1.4, alpha: occupied ? 1 : 0.72 })
			hex.eventMode = props.readOnly ? 'none' : 'static'
			hex.cursor = props.readOnly ? 'default' : 'pointer'
			hex.on('pointertap', () => props.onHexClick?.(coord))
			stage?.addChild(hex)

			if (!entry) return
			const spriteKey = visualAlveoli[entry.alveolusType]?.sprites?.[0]
			const texture = spriteKey ? assetManager.getTexture(spriteKey) : Texture.WHITE
			if (texture === Texture.WHITE) return
			const sprite = new Sprite(texture)
			sprite.anchor.set(0.5)
			sprite.x = x
			sprite.y = y
			const textureWidth = Math.max(1, texture.width)
			const textureHeight = Math.max(1, texture.height)
			const spriteScale = Math.min(
				(side * 1.32 * scale) / textureWidth,
				(side * 1.32 * scale) / textureHeight
			)
			sprite.scale.set(spriteScale)
			stage?.addChild(sprite)

			// Variant badge overlay
			if (entry.variant) {
				const badgeKey = `${entry.alveolusType}.${entry.variant}`
				const badgeDef = variantBadges[badgeKey]
				const badgeTextureName = badgeDef?.sprites?.[0]
				if (badgeTextureName) {
					const badgeTex = assetManager.getTexture(badgeTextureName)
					if (badgeTex && badgeTex !== Texture.WHITE) {
						const badge = new Sprite(badgeTex)
						badge.anchor.set(1, 0)
						const badgeSize = side * 0.42 * scale
						const maxDim = Math.max(badgeTex.width, badgeTex.height)
						if (maxDim > 1) {
							badge.scale.set(badgeSize / maxDim)
						}
						badge.x = x + side * 0.5 * scale
						badge.y = y - side * 0.5 * scale
						stage?.addChild(badge)
					}
				}
			}
		}
		for (const coord of candidates) drawHex(coord, false)
		for (const entry of entries) drawHex({ q: entry.coord[0], r: entry.coord[1] }, true)
		try {
			app.render()
		} catch (error) {
			console.warn('[HivePlanCanvas] Pixi render failed.', error)
		}
	}

	effect`hive-plan-canvas:draw`(() => {
		props.plan?.entries.length
		props.selectedRoleId
		props.selectedAction
		props.issues.map((issue) => issue.message).join('|')
		draw()
	})

	const mount = (element: HTMLElement) => {
		if (host || app) return
		host = element
		mounted = true
		void (async () => {
			await assetManager.load()
			if (!mounted || !host) return
			const next = new Application()
			await next.init({
				width: host.clientWidth || 420,
				height: host.clientHeight || 320,
				backgroundAlpha: 0,
				antialias: true,
				autoDensity: true,
			})
			if (!mounted || !host) {
				deferPixiDestroy(next, undefined)
				return
			}
			app = next
			app.ticker?.stop()
			stage = new Container()
			app.stage.addChild(stage)
			host.appendChild(app.canvas)
			resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					if (entry.target !== host || !app) continue
					const { width, height } = entry.contentRect
					if (width <= 0 || height <= 0) continue
					app.renderer.resize(width, height)
					draw()
				}
			})
			resizeObserver.observe(host)
			draw()
		})()
		return () => {
			mounted = false
			resizeObserver?.disconnect()
			if (app) deferPixiDestroy(app, stage)
			stage = undefined
			app = undefined
			host = undefined
		}
	}

	return <div class="hive-plan-canvas" use={mount} />
}

export default HivePlanCanvas
