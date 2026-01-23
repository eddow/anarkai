import { unreactive } from 'mutts'
import { GameObject } from '$lib/game/object'
import type { Storage } from '$lib/storage/storage'
import type { Positioned } from '$lib/utils'
import { type Position, toAxialCoord } from '$lib/utils/position'
import type { HexBoard } from '../board'
import type { Tile } from '../tile'

export abstract class TileBorderContent extends GameObject {
	abstract readonly border: TileBorder
	abstract readonly storage?: Storage
	abstract readonly debugInfo: Record<string, any>
}

@unreactive
export class TileBorder extends GameObject {
	readonly uid: string
	readonly position: Position
	readonly board: HexBoard

	constructor(board: HexBoard, coord: Positioned) {
		const axialCoord = toAxialCoord(coord)
		super(board.game, `border:${axialCoord.q},${axialCoord.r}`)
		this.uid = `border:${axialCoord.q},${axialCoord.r}`
		this.board = board
		this.position = axialCoord
		this.tile = {
			get a(): Tile {
				return board.getTile({ q: Math.ceil(axialCoord.q), r: Math.floor(axialCoord.r) })!
			},
			get b(): Tile {
				return board.getTile({ q: Math.floor(axialCoord.q), r: Math.ceil(axialCoord.r) })!
			},
		}
	}

	tile: {
		get a(): Tile
		get b(): Tile
	}

	get content(): TileBorderContent | undefined {
		return this.board.getBorderContent(toAxialCoord(this.position))
	}

	set content(content: TileBorderContent | undefined) {
		this.content?.destroy?.()
		this.board.setBorderContent(toAxialCoord(this.position), content)
	}

	get debugInfo(): Record<string, any> {
		return {
			position: this.position,
			content: this.content?.debugInfo,
		}
	}
}
