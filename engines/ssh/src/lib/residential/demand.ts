import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { traces } from 'ssh/debug'
import type { Game } from 'ssh/game/game'
import { GameObject } from 'ssh/game/object'
import {
	residentialBasicDwellingProject,
	residentialHousingDemandRadius,
	residentialProjectSpawnCooldownSeconds,
} from 'ssh/residential/constants'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

function countPeopleNear(game: Game, center: { q: number; r: number }, radius: number): number {
	let n = 0
	for (const character of game.population) {
		const ac = toAxialCoord(character.position)
		if (!ac) continue
		if (axial.distance(ac, center) <= radius) n++
	}
	return n
}

function countFreeDwellingSlotsNear(
	game: Game,
	center: { q: number; r: number },
	radius: number
): number {
	let slots = 0
	for (const tile of game.hex.tiles) {
		const content = tile.content
		if (!(content instanceof BasicDwelling)) continue
		const ac = toAxialCoord(tile.position)
		if (!ac) continue
		if (axial.distance(ac, center) > radius) continue
		slots += content.freeHomeSlots
	}
	return slots
}

function hasResidentialConstructionInProgress(game: Game): boolean {
	for (const tile of game.hex.tiles) {
		const content = tile.content
		if (content instanceof UnBuiltLand && content.project === residentialBasicDwellingProject) {
			return true
		}
		if (content instanceof BuildDwelling) return true
	}
	return false
}

/**
 * When local housing pressure is positive, starts at most one new residential construction
 * project on a clear, zoned, empty `UnBuiltLand` tile (deterministic tie-break).
 */
export function trySpawnResidentialProject(game: Game): void {
	if (hasResidentialConstructionInProgress(game)) return

	const candidates: { pressure: number; q: number; r: number }[] = []

	for (const tile of game.hex.tiles) {
		if (tile.zone !== 'residential') continue
		const content = tile.content
		if (!(content instanceof UnBuiltLand)) continue
		if (content.project) continue
		if (!tile.isClear) continue
		const center = toAxialCoord(tile.position)
		if (!center) continue
		const people = countPeopleNear(game, center, residentialHousingDemandRadius)
		const freeSlots = countFreeDwellingSlotsNear(game, center, residentialHousingDemandRadius)
		const pressure = Math.max(0, people - freeSlots)
		if (pressure <= 0) continue
		candidates.push({ pressure, q: center.q, r: center.r })
	}

	if (candidates.length === 0) return

	candidates.sort((a, b) => {
		if (b.pressure !== a.pressure) return b.pressure - a.pressure
		if (a.q !== b.q) return a.q - b.q
		return a.r - b.r
	})

	const best = candidates[0]!
	const tile = game.hex.getTile({ q: best.q, r: best.r })
	if (!tile) return
	const land = tile.content
	if (!(land instanceof UnBuiltLand)) return
	if (land.project) return
	land.setProject(residentialBasicDwellingProject)
	traces.residential?.log('[residential] spawned basic dwelling project', {
		q: best.q,
		r: best.r,
		pressure: best.pressure,
	})
}

/** Periodically evaluates housing demand and may start a residential construction project. */
export class ResidentialDemandTicker extends GameObject {
	private cooldownSeconds = 0

	constructor(game: Game) {
		super(game)
		game.registerTickedObject(this)
	}

	override destroy(): void {
		this.game.unregisterTickedObject(this)
		super.destroy()
	}

	update(deltaSeconds: number): void {
		this.cooldownSeconds += deltaSeconds
		if (this.cooldownSeconds < residentialProjectSpawnCooldownSeconds) return
		this.cooldownSeconds = 0
		trySpawnResidentialProject(this.game)
	}
}
