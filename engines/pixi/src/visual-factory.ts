import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Tile } from 'ssh/board/tile'
import type { GameObject } from 'ssh/game/object'
import type { InteractiveGameObject } from 'ssh/game/object'
import { Character } from 'ssh/population/character'
import type { PixiGameRenderer } from './renderer'
import { CharacterVisual } from './renderers/character-visual'
import { LooseGoodsVisual } from './renderers/loose-goods-visual'
import { TileVisual } from './renderers/tile-visual'
import type { VisualObject } from './renderers/visual-object'

const VISUAL_DIAGNOSTIC_HISTORY_LIMIT = 12
const SLOW_VISUAL_BATCH_THRESHOLD_MS = 8

export interface VisualBatchDiagnostics {
	reason: 'bootstrap' | 'objectsAdded' | 'objectsChanged'
	objectCount: number
	tileCount: number
	characterCount: number
	tileVisualCreatedCount: number
	skippedPlainTileCount: number
	gateOverlayCount: number
	createdVisualCount: number
	reusedVisualCount: number
	groundAttachCount: number
	worldAttachCount: number
	totalVisualsAfterBatch: number
	batchMs: number
}

export interface VisualFactoryDiagnostics {
	recentBatches: VisualBatchDiagnostics[]
	totals: {
		batches: number
		createdVisuals: number
		reusedVisuals: number
		groundAttachments: number
		worldAttachments: number
		maxBatchMs: number
	}
	current: {
		totalVisuals: number
		tileVisuals: number
		gateOverlayVisuals: number
		characterVisuals: number
		looseGoodsVisuals: number
		alveolusVisuals: number
	}
}

export class VisualFactory {
	private cleanups: (() => void)[] = []
	private diagnostics: VisualFactoryDiagnostics = {
		recentBatches: [],
		totals: {
			batches: 0,
			createdVisuals: 0,
			reusedVisuals: 0,
			groundAttachments: 0,
			worldAttachments: 0,
			maxBatchMs: 0,
		},
		current: {
			totalVisuals: 0,
			tileVisuals: 0,
			gateOverlayVisuals: 0,
			characterVisuals: 0,
			looseGoodsVisuals: 0,
			alveolusVisuals: 0,
		},
	}

	constructor(private renderer: PixiGameRenderer) {}

	public bind() {
		console.log('[VisualFactory] Binding visuals...')
		const board = this.renderer.game.hex

		console.log('[VisualFactory] Creating bootstrap visuals...')
		this.createBatch(Array.from(this.renderer.game.objects.values()), 'bootstrap')

		console.log('[VisualFactory] Creating LooseGoods Visual...')
		const looseGoodsVisual = this.create(board.looseGoods, LooseGoodsVisual).visual
		if (looseGoodsVisual) {
			this.renderer.worldScene.addChild(looseGoodsVisual.view)
		}

		const onObjectsAdded = (objects: InteractiveGameObject[]) => {
			this.createBatch(objects, 'objectsAdded')
		}
		const onObjectsChanged = (objects: InteractiveGameObject[]) => {
			this.syncChangedObjects(objects)
		}
		const onObjectsRemoved = (objects: InteractiveGameObject[]) => {
			for (const object of objects) {
				const visual = this.renderer.visuals.get(object.uid)
				if (!visual) continue
				visual.dispose()
				this.renderer.visuals.delete(object.uid)
			}
		}
		this.renderer.game.on({
			objectsAdded: onObjectsAdded,
			objectsChanged: onObjectsChanged,
			objectsRemoved: onObjectsRemoved,
		})
		this.cleanups.push(() => {
			this.renderer.game.off({
				objectsAdded: onObjectsAdded,
				objectsChanged: onObjectsChanged,
				objectsRemoved: onObjectsRemoved,
			})
		})
	}

	public getDiagnostics(): VisualFactoryDiagnostics {
		const currentCounts = this.getCurrentVisualCounts()
		return {
			recentBatches: this.diagnostics.recentBatches.map((batch) => ({ ...batch })),
			totals: { ...this.diagnostics.totals },
			current: currentCounts,
		}
	}

	private getCurrentVisualCounts(): VisualFactoryDiagnostics['current'] {
		const tileVisuals = Array.from(this.renderer.visuals.values()).filter(
			(visual) => visual instanceof TileVisual
		).length
		const characterVisuals = Array.from(this.renderer.visuals.values()).filter(
			(visual) => visual instanceof CharacterVisual
		).length
		const looseGoodsVisuals = Array.from(this.renderer.visuals.values()).filter(
			(visual) => visual instanceof LooseGoodsVisual
		).length
		const alveolusVisuals = this.renderer.layers.alveoli.renderLayerChildren.length
		const gateOverlayVisuals = this.renderer.layers.storedGoods.renderLayerChildren.filter((child) =>
			child.label.includes('/gates')
		).length
		return {
			totalVisuals: this.renderer.visuals.size,
			tileVisuals,
			gateOverlayVisuals,
			characterVisuals,
			looseGoodsVisuals,
			alveolusVisuals,
		}
	}

	private shouldCreateTileVisual(tile: Tile): boolean {
		if (tile.zone !== undefined) return true
		const content = tile.content
		if (!content) return false
		if (content instanceof Alveolus) return true
		if (content instanceof UnBuiltLand) {
			return !!content.project || !!content.deposit
		}
		return true
	}

	private create<T extends GameObject>(
		object: T,
		VisualClass: new (obj: T, renderer: PixiGameRenderer) => VisualObject<T>
	): { visual: VisualObject<T> | undefined; reused: boolean } {
		if (!this.renderer?.app) return { visual: undefined, reused: false }
		if (this.renderer.visuals.has(object.uid)) {
			return {
				visual: this.renderer.visuals.get(object.uid) as VisualObject<T>,
				reused: true,
			}
		}

		let visual: VisualObject<T> | undefined

		try {
			visual = new VisualClass(object, this.renderer)
			visual.bind()
			this.renderer.visuals.set(object.uid, visual)
		} catch (e) {
			console.error('[VisualFactory] Error creating visual:', e)
			return { visual: undefined, reused: false }
		}

		return { visual, reused: false }
	}

	private createBatch(
		objects: Iterable<InteractiveGameObject>,
		reason: VisualBatchDiagnostics['reason']
	) {
		const batchStartedAt = globalThis.performance?.now() ?? Date.now()
		const groundViews: VisualObject[] = []
		const worldViews: VisualObject[] = []
		let objectCount = 0
		let tileCount = 0
		let characterCount = 0
		let tileVisualCreatedCount = 0
		let skippedPlainTileCount = 0
		let createdVisualCount = 0
		let reusedVisualCount = 0

		for (const object of objects) {
			objectCount++
			if (object instanceof Tile) {
				tileCount++
				if (!this.shouldCreateTileVisual(object)) {
					skippedPlainTileCount++
					continue
				}
				const tileVisualResult = this.create(object, TileVisual)
				const tileVisual = tileVisualResult.visual
				if (tileVisualResult.reused) reusedVisualCount++
				else if (tileVisual) {
					createdVisualCount++
					tileVisualCreatedCount++
				}
				if (tileVisual) groundViews.push(tileVisual)
				continue
			}
			if (object instanceof Character) {
				characterCount++
				const characterVisualResult = this.create(object, CharacterVisual)
				const characterVisual = characterVisualResult.visual
				if (characterVisualResult.reused) reusedVisualCount++
				else if (characterVisual) createdVisualCount++
				if (characterVisual) worldViews.push(characterVisual)
			}
		}

		for (const visual of groundViews) {
			this.renderer.worldScene.addChild(visual.view)
			this.renderer.attachToLayer(this.renderer.layers.ground, visual.view)
		}

		for (const visual of worldViews) {
			this.renderer.worldScene.addChild(visual.view)
		}

		const batchMs = (globalThis.performance?.now() ?? Date.now()) - batchStartedAt
		const batchDiagnostics: VisualBatchDiagnostics = {
			reason,
			objectCount,
			tileCount,
			characterCount,
			tileVisualCreatedCount,
			skippedPlainTileCount,
			gateOverlayCount: this.getCurrentVisualCounts().gateOverlayVisuals,
			createdVisualCount,
			reusedVisualCount,
			groundAttachCount: groundViews.length,
			worldAttachCount: worldViews.length,
			totalVisualsAfterBatch: this.renderer.visuals.size,
			batchMs,
		}
		this.diagnostics.recentBatches.unshift(batchDiagnostics)
		this.diagnostics.recentBatches = this.diagnostics.recentBatches.slice(
			0,
			VISUAL_DIAGNOSTIC_HISTORY_LIMIT
		)
		this.diagnostics.totals.batches++
		this.diagnostics.totals.createdVisuals += createdVisualCount
		this.diagnostics.totals.reusedVisuals += reusedVisualCount
		this.diagnostics.totals.groundAttachments += groundViews.length
		this.diagnostics.totals.worldAttachments += worldViews.length
		this.diagnostics.totals.maxBatchMs = Math.max(this.diagnostics.totals.maxBatchMs, batchMs)
		this.diagnostics.current = this.getCurrentVisualCounts()

		if (batchMs >= SLOW_VISUAL_BATCH_THRESHOLD_MS) {
			console.debug('[VisualFactory] Slow visual batch', batchDiagnostics)
		}
	}

	private syncChangedObjects(objects: Iterable<InteractiveGameObject>) {
		const changedForCreation: InteractiveGameObject[] = []
		for (const object of objects) {
			if (object instanceof Tile) {
				const existing = this.renderer.visuals.get(object.uid)
				if (this.shouldCreateTileVisual(object)) {
					if (!existing) changedForCreation.push(object)
				} else if (existing) {
					existing.dispose()
					this.renderer.visuals.delete(object.uid)
				}
				continue
			}
			if (!this.renderer.visuals.has(object.uid)) changedForCreation.push(object)
		}
		if (changedForCreation.length > 0) {
			this.createBatch(changedForCreation, 'objectsChanged')
		} else {
			this.diagnostics.current = this.getCurrentVisualCounts()
		}
	}

	public destroy() {
		// Destroy all visuals
		this.renderer.visuals.forEach((v) => v.dispose())
		this.renderer.visuals.clear()
		this.cleanups.forEach((c) => c())
	}
}
