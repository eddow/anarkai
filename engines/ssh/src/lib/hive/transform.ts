import { jobBalance } from 'engine-rules'
import { inert, reactive, untracked } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { SpecificStorage } from 'ssh/storage'
import type { GoodType, TransformJob } from 'ssh/types/base'
import { type ExchangePriority, type GoodsRelations, maxPriority } from 'ssh/utils/advertisement'
import { epsilon } from 'ssh/utils/varied'
import { inputBufferSize, outputBufferSize } from '../../../assets/constants'

const emptyGoods: Partial<Record<GoodType, number>> = {}
const transformStorageCapacity = (rates: Record<string, number>): Ssh.SpecificStorage =>
	Object.fromEntries(
		Object.entries(rates)
			.filter(([, rate]) => rate !== 0)
			.map(([goodType, rate]) => [
				goodType,
				rate < 0 ? inputBufferSize : outputBufferSize,
			])
	)

@reactive
export class TransformAlveolus extends Alveolus {
	declare action: Ssh.TransformationAction
	public processBuffers: Partial<Record<GoodType, number>>

	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'transform') {
			throw new Error('TransformAlveolus can only be created from a transform action')
		}
		super(tile, new SpecificStorage(transformStorageCapacity(definition.action.rates)))
		this.processBuffers = Object.fromEntries(
			Object.keys(definition.action.rates).map((goodType) => [goodType, 0])
		) as Partial<Record<GoodType, number>>
		this.assignGameContent(definition, resourceName)
	}

	get rateEntries(): Array<[GoodType, number]> {
		return (Object.entries(this.action.rates) as Array<[GoodType, number]>)
			.filter(([, rate]) => rate !== 0)
			.sort(([a], [b]) => a.localeCompare(b))
	}

	get consumedGoods(): GoodType[] {
		return this.rateEntries.filter(([, rate]) => rate < 0).map(([goodType]) => goodType)
	}

	get producedGoods(): GoodType[] {
		return this.rateEntries.filter(([, rate]) => rate > 0).map(([goodType]) => goodType)
	}

	processBuffer(goodType: GoodType): number {
		return this.processBuffers[goodType] ?? 0
	}

	setProcessBuffer(goodType: GoodType, value: number): void {
		const clamped = Math.max(0, Math.min(1, value))
		if (Math.abs(this.processBuffer(goodType) - clamped) <= epsilon) return
		this.processBuffers[goodType] = clamped
		this.notifyProcessBufferChanged()
	}

	restoreProcessBuffers(buffers: Partial<Record<GoodType, number>> | undefined): void {
		if (!buffers) return
		for (const [goodType] of this.rateEntries) {
			this.processBuffers[goodType] = Math.max(0, Math.min(1, buffers[goodType] ?? 0))
		}
		this.notifyProcessBufferChanged()
	}

	notifyProcessBufferChanged(): void {
		this.game.enqueueStoragePresentationChange?.(this.tile)
		this.hive?.invalidateAdvertisement?.(this, 'transform.processBuffer')
	}

	canLoad(goodType: GoodType): boolean {
		return this.storage.available(goodType) >= 1
	}

	canUnload(goodType: GoodType): boolean {
		return this.storage.canStoreAll({ [goodType]: 1 })
	}

	get nextLoadGood(): GoodType | undefined {
		if (!this.producedGoods.every((goodType) => this.canUnload(goodType))) return undefined
		return this.consumedGoods.find(
			(goodType) => this.processBuffer(goodType) <= epsilon && this.canLoad(goodType)
		)
	}

	get nextUnloadGood(): GoodType | undefined {
		return this.producedGoods.find(
			(goodType) => this.processBuffer(goodType) >= 1 - epsilon && this.canUnload(goodType)
		)
	}

	/**
	 * Check if this transformer can take a specific good as input
	 */
	canTake(goodType: GoodType, _priority: ExchangePriority): boolean {
		if (!this.working) return false

		const action = this.action
		const rates = action?.rates ?? emptyGoods

		// Can only take goods that are defined as inputs
		const isInput = (rates[goodType] ?? 0) < 0

		// Check if storage has capacity for this input
		// Use canStoreAll to check if we can store at least 1 of this good type
		const hasCapacity = this.storage.canStoreAll({ [goodType]: 1 })

		return isInput && hasCapacity
	}

	/**
	 * Check if this transformer can give a specific good as output
	 */
	canGive(goodType: GoodType, _priority: ExchangePriority): boolean {
		if (!this.working) return false

		const action = this.action
		const rates = action?.rates ?? emptyGoods

		// Can only give goods that are defined as outputs
		const isOutput = (rates[goodType] ?? 0) > 0

		// Check if storage has available goods of this type
		const hasAvailable = this.storage.available(goodType) > 0

		return isOutput && hasAvailable
	}

	get canWork(): boolean {
		const hasOutputRoom = this.producedGoods.every((goodType) => this.canUnload(goodType))
		const canUnloadBoundary = this.producedGoods.some(
			(goodType) => this.processBuffer(goodType) >= 1 - epsilon && this.canUnload(goodType)
		)
		const canLoadBoundary =
			hasOutputRoom &&
			this.consumedGoods.some(
				(goodType) => this.processBuffer(goodType) <= epsilon && this.canLoad(goodType)
			)
		const canProcess =
			hasOutputRoom &&
			this.consumedGoods.every((goodType) => this.processBuffer(goodType) > epsilon) &&
			this.producedGoods.every((goodType) => this.processBuffer(goodType) < 1 - epsilon)
		return canUnloadBoundary || canLoadBoundary || canProcess
	}
	@inert
	protected override nextAlveolusJob(): TransformJob | undefined {
		if (!this.canProposeAlveolusSpecificJobs || !this.canWork) return undefined

		return {
			job: 'transform',
			urgency: jobBalance.transform,
			fatigue: this.getFatigueCost(),
		}
	}

	override getFatigueCost(): number {
		return 0
	}

	get workingGoodsRelations(): GoodsRelations {
		const action = this.action
		const rates = action?.rates ?? emptyGoods
		const demandPriority = untracked`transform.workingGoodsRelations.demandPriority`(() =>
			maxPriority(
				Object.entries(rates)
					.filter(([, rate]) => rate > 0)
					.map(([goodType]) => (this.hive.needs[goodType as GoodType] ? '1-buffer' : '2-use'))
			)
		)
		// Note: only depend on stock (actual goods), never on reservation/allocation bookkeeping.
		const stock = this.storage.stock
		return Object.fromEntries([
			...Object.entries(rates)
				.filter(([, rate]) => rate < 0)
				.filter(([goodType]) => {
					const plannedStock =
						(stock[goodType as GoodType] ?? 0) + this.storage.allocated(goodType as GoodType)
					return plannedStock < inputBufferSize
				})
				.map(([goodType]) => [
					goodType as GoodType,
					{ advertisement: 'demand', priority: demandPriority },
				]),
			...Object.entries(rates)
				.filter(([, rate]) => rate > 0)
				.map(([goodType]) => goodType)
				.filter((goodType) => this.canGive(goodType as GoodType, '2-use'))
				.map((goodType) => [goodType as GoodType, { advertisement: 'provide', priority: '2-use' }]),
		])
	}
}
