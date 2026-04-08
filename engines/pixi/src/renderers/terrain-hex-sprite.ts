import { Container, Graphics, Point, TilingSprite, type Texture } from 'pixi.js'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from '../debug-names'

export interface PointLike {
	x: number
	y: number
}

const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
	const angle = (Math.PI / 3) * (i + 0.5)
	return new Point(Math.cos(angle) * tileSize, Math.sin(angle) * tileSize)
})

export function createHexMask(scale = 1): Graphics {
	const mask = new Graphics()
	mask.poly(HEX_POINTS.map((point) => new Point(point.x * scale, point.y * scale))).fill(0xffffff)
	return mask
}

export function createTerrainHexSprite({
	scope,
	texture,
	position,
	tileOrigin,
	tint = 0xffffff,
}: {
	scope: string
	texture: Texture
	position: PointLike
	tileOrigin: PointLike
	tint?: number
}): {
	container: Container
	sprite: TilingSprite
	mask: Graphics
} {
	const sprite = setPixiName(
		new TilingSprite({
			texture,
			width: tileSize * 2,
			height: tileSize * 2,
		}),
		`${scope}:background`
	)
	sprite.anchor.set(0.5)
	sprite.position.set(position.x, position.y)
	sprite.tilePosition.set(
		-tileOrigin.x % (sprite.texture.width || tileSize),
		-tileOrigin.y % (sprite.texture.height || tileSize)
	)
	sprite.tint = tint

	const mask = setPixiName(createHexMask(), `${scope}:mask`)
	mask.position.set(position.x, position.y)
	sprite.mask = mask

	const container = setPixiName(new Container(), scope)
	container.eventMode = 'none'
	container.addChild(sprite, mask)
	return { container, sprite, mask }
}
