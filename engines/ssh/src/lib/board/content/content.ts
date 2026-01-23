import { GameObject } from '$lib/game/object'
import type { Storage } from '$lib/storage/storage'
import type { Tile } from '../tile'

export abstract class TileContent extends GameObject {
	abstract readonly tile: Tile
	// TODO: translate-> name = translation set on load
	abstract readonly name?: string
	abstract readonly debugInfo: Record<string, any>
	abstract readonly walkTime: number
	abstract readonly background: string
	// Optional storage - undefined for tiles that don't store goods
	abstract storage?: Storage
	/**
	 * Render the tile content including both background and content
	 * @returns A cleanup function to be called when the content is removed
	 */

	/**
	 * Check if this tile content can perform the given action
	 * @param action - The action to check
	 * @returns true if the action can be performed
	 */
	abstract canInteract?(action: string): boolean

	/**
	 * Get color code for this tile content based on zone or other status
	 * @returns Object with tint and optional borderColor
	 */
	colorCode(): { tint: number; borderColor?: number } {
		// Base colors based on zone
		if (this.tile.zone === 'residential') {
			return { tint: 0xaaffaa, borderColor: 0x44dd44 } // greenish tint, strong green border
		} else if (this.tile.zone === 'harvest') {
			return { tint: 0xccaa88, borderColor: 0xaa7744 } // brownish tint, strong brown border
		}
		return { tint: 0xffffff } // default white (no tint)
	}

	/**
	 * Helper to render tile background (hexagonal sprite)
	 * Should be called by subclasses in their render() method
	 */
}
