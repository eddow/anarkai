import { Container, Graphics } from 'pixi.js'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'

const ROAD_COLOR = 0x6b3f1d

export class RoadOverlay {
	private readonly container: Container
	private readonly graphics: Graphics
	private cleanup?: () => void

	constructor(private readonly renderer: PixiGameRenderer) {
		const scope = 'overlay:roads'
		this.container = setPixiName(new Container(), scope)
		this.graphics = setPixiName(new Graphics(), scopedPixiName(scope, 'graphics'))
		this.container.addChild(this.graphics)
	}

	bind(): void {
		this.renderer.worldScene.addChild(this.container)
		this.renderer.attachToLayer(this.renderer.layers.roads, this.container)
		const onRoadsChanged = () => this.render()
		this.renderer.game.on({ roadsChanged: onRoadsChanged })
		this.cleanup = () => this.renderer.game.off({ roadsChanged: onRoadsChanged })
		this.render()
	}

	render(): void {
		this.graphics.clear()
		for (const road of this.renderer.game.hex.roadSegments()) {
			if (road.type !== 'path') continue
			const border = this.renderer.game.hex.getBorder(road.coord)
			if (!border) continue
			const a = toWorldCoord(border.tile.a.position)
			const b = toWorldCoord(border.tile.b.position)
			if (!a || !b) continue
			this.graphics.moveTo(a.x, a.y)
			this.graphics.lineTo(b.x, b.y)
			this.graphics.stroke({
				width: tileSize * 0.22,
				color: ROAD_COLOR,
				alpha: 0.95,
				cap: 'round',
				join: 'round',
			})
		}
	}

	dispose(): void {
		this.cleanup?.()
		this.renderer.detachFromLayer(this.renderer.layers.roads, this.container)
		this.container.removeFromParent()
		this.container.destroy({ children: true })
	}
}
