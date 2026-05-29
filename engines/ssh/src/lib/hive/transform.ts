import { configurations } from 'engine-rules'
import { reactive, untracked } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { SpecificStorage } from 'ssh/storage'
import type { GoodType, TransformJob } from 'ssh/types/base'
import { type ExchangePriority, type GoodsRelations, maxPriority } from 'ssh/utils/advertisement'
import { epsilon } from 'ssh/utils/varied'
import { inputBufferSize, outputBufferSize } from '../../../assets/constants'
import { isTransformConfiguration } from './alveolus-configuration'

const emptyGoods: Partial<Record<GoodType, number>> = {}
type ProductRatioRuntimeConfiguration = {
	inputGood: GoodType
	outputGood: GoodType
	maxProductRatio: number
}
const transformStorageCapacity = (rates: Record<string, number>): Ssh.SpecificStorage =>
	Object.fromEntries(
		Object.entries(rates)
			.filter(([, rate]) => rate !== 0)
			.map(([goodType, rate]) => [goodType, rate < 0 ? inputBufferSize : outputBufferSize])
	)

@reactive
export class TransformAlveolus extends Alveolus {
	declare action: Ssh.TransformationAction
	declare individualConfiguration: Ssh.TransformAlveolusConfiguration | undefined
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

	get transformConfiguration(): Ssh.TransformAlveolusConfiguration {
		const baseConfig = this.configuration
		const defaults = configurations.transform as Ssh.TransformAlveolusConfiguration
		return {
			...defaults,
			working: baseConfig.working,
			productRatio: isTransformConfiguration(baseConfig)
				? baseConfig.productRatio
				: (this.action.productRatio ?? defaults.productRatio),
		}
	}

	private get productRatioConfiguration(): ProductRatioRuntimeConfiguration | undefined {
		const config = this.transformConfiguration.productRatio
		if (!config || !Number.isFinite(config.maxProductRatio)) return undefined
		const inputGood = (config.inputGood as GoodType | undefined) ?? this.consumedGoods[0]
		const outputGood = (config.outputGood as GoodType | undefined) ?? this.producedGoods[0]
		if (!inputGood || !outputGood) return undefined
		if (!this.consumedGoods.includes(inputGood) || !this.producedGoods.includes(outputGood)) {
			return undefined
		}
		return {
			inputGood,
			outputGood,
			maxProductRatio: Math.max(0, Math.min(1, config.maxProductRatio)),
		}
	}

	get isBelowProductRatioLimit(): boolean {
		const config = this.productRatioConfiguration
		if (!config) return true
		const inputAmount = this.hiveGoodAmountForProductRatio(config.inputGood)
		const outputAmount = this.hiveGoodAmountForProductRatio(config.outputGood)
		const total = inputAmount + outputAmount
		if (total <= epsilon) return true
		return outputAmount / total < config.maxProductRatio - epsilon
	}

	private hiveGoodAmountForProductRatio(goodType: GoodType): number {
		const alveoli = this.hive?.alveoli ?? [this]
		let amount = 0
		for (const alveolus of alveoli) {
			amount += alveolus.storage.stock[goodType] ?? 0
			if (alveolus instanceof TransformAlveolus) {
				amount += alveolus.processBuffer(goodType)
			}
		}
		return amount
	}

	setProductRatioConfiguration(config: Ssh.TransformProductRatioConfiguration): void {
		if (this.configurationRef.scope !== 'individual') {
			this.configurationRef = { scope: 'individual' }
		}
		if (!this.individualConfiguration || !isTransformConfiguration(this.individualConfiguration)) {
			this.individualConfiguration = reactive({
				...(configurations.transform as Ssh.TransformAlveolusConfiguration),
				working: this.configuration.working,
				productRatio: this.transformConfiguration.productRatio,
			})
		}
		this.individualConfiguration.productRatio = {
			...config,
			maxProductRatio: Math.max(0, Math.min(1, config.maxProductRatio)),
		}
		this.hive?.invalidateAdvertisement?.(this, 'alveolus.config')
		this.hive?.invalidateConveyPlanning?.('alveolus.config')
		this.game.invalidateWorkPlanning('alveolus.config')
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

	get hasOutputRoom(): boolean {
		return this.producedGoods.every((goodType) => this.canUnload(goodType))
	}

	get nextLoadGood(): GoodType | undefined {
		if (!this.hasOutputRoom) return undefined
		if (!this.isBelowProductRatioLimit) return undefined
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

		// Do not accept more inputs if the next produced unit would have nowhere to unload.
		const hasOutputRoom = this.hasOutputRoom

		// Check if storage has capacity for this input
		// Use canStoreAll to check if we can store at least 1 of this good type
		const hasCapacity = this.storage.canStoreAll({ [goodType]: 1 })

		return isInput && hasOutputRoom && hasCapacity
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
		const hasOutputRoom = this.hasOutputRoom
		const canUnloadBoundary = this.producedGoods.some(
			(goodType) => this.processBuffer(goodType) >= 1 - epsilon && this.canUnload(goodType)
		)
		const canLoadBoundary =
			hasOutputRoom &&
			this.isBelowProductRatioLimit &&
			this.consumedGoods.some(
				(goodType) => this.processBuffer(goodType) <= epsilon && this.canLoad(goodType)
			)
		const canProcess =
			hasOutputRoom &&
			this.isBelowProductRatioLimit &&
			this.consumedGoods.every((goodType) => this.processBuffer(goodType) > epsilon) &&
			this.producedGoods.every((goodType) => this.processBuffer(goodType) < 1 - epsilon)
		return canUnloadBoundary || canLoadBoundary || canProcess
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
					return this.hasOutputRoom && plannedStock < inputBufferSize
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
