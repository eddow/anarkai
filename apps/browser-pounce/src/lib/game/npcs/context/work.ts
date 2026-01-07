import { atomic } from 'mutts'
import { alveoli } from '$assets/game-content'
import { assert } from '$lib/debug'
import { UnBuiltLand } from '$lib/game/board/content/unbuilt-land'
import { alveolusClass } from '$lib/game/hive'
import { BuildAlveolus } from '$lib/game/hive/build'
import type { StorageAlveolus } from '$lib/game/hive/storage'
import type { TransformAlveolus } from '$lib/game/hive/transform'
import type { Character } from '$lib/game/population/character'
import type { AllocationBase } from '$lib/game/storage'
import { contract, type Goods, type GoodType } from '$lib/types'
import { type AxialCoord, axial } from '$lib/utils'
import { subject } from '../scripts'
import { DurationStep, MultiMoveStep, WaitForPredicateStep } from '../steps'
import type { WorkPlan } from '.'

// Unified handling for both single and multiple movements
// Prepare all movements: fulfill source, allocate hop, create moving good
interface MovementData {
	mg: any
	hopAlloc: any
	hop: AxialCoord
	moving: any
}

class WorkFunctions {
	declare [subject]: Character
	@contract('WorkPlan')
	prepare(workPlan: WorkPlan) {
		if (['convey', 'offload'].includes(workPlan.job)) return
		assert(
			this[subject].assignedAlveolus?.preparationTime,
			'assignedAlveolus must be set and have a preparationTime',
		)
		return new DurationStep(
			this[subject].assignedAlveolus!.preparationTime,
			'work',
			`prepare.${workPlan.job}`,
		)
	}

	@contract()
	myNextJob() {
		const alveolus = this[subject].assignedAlveolus
		assert(alveolus, 'assignedAlveolus must be set')
		assert(
			'nextJob' in alveolus && typeof alveolus.nextJob === 'function',
			'alveolus must have nextJob method',
		)
		return alveolus.nextJob(this[subject])
	}
	@contract()
	waitForIncomingGoods() {
		return new WaitForPredicateStep(
			'waitIncomingGoods',
			() => !!this[subject].assignedAlveolus!.aGoodMovement,
		)
	}
	@contract()
	@atomic
	conveyStep() {
		const character = this[subject]
		const alveolus = character.assignedAlveolus!
		assert(
			alveolus === character.tile.content,
			'Character must be assigned to the alveolus on the same tile',
		)
		// Get movement(s) - either a single movement or a cycle
		const movements = alveolus.aGoodMovement
		if (!movements || movements.length === 0) return

		const hive = alveolus.hive

		const movementData: MovementData[] = []

		for (const mg of movements) {
			mg.allocations.source.fulfill()
			const hop = mg.hop()!

			const nextStorage = hive.storageAt(hop)
			assert(nextStorage, 'nextStorage must be defined')
			const hopAlloc = mg.path.length
				? nextStorage.allocate({ [mg.goodType]: 1 }, { type: 'convey.hop', movement: mg })
				: undefined

			const moving = character.game.hex.freeGoods.add(alveolus.tile, mg.goodType, {
				position: mg.from,
				available: false,
			})

			movementData.push({
				mg,
				hopAlloc,
				hop,
				moving,
			})
		}

		// Calculate time: O(n²) for cycles, O(n) for single movements
		let totalTime = 0
		for (let i = 0; i < movementData.length; i++) {
			const distance = axial.distance(movementData[i].mg.from, movementData[i].hop)
			totalTime += character.vehicle.transferTime * distance * movementData.length
		}

		// Create unified MultiMoveStep that animates all movements
		const description =
			movementData.length === 1 ? `convey.${movementData[0].mg.goodType}` : `convey.cycle`
		const visualMovements = movementData.map(({ moving, mg, hop }) => ({
			who: moving,
			from: mg.from,
			to: hop,
		}))
		return new MultiMoveStep(totalTime, visualMovements, 'work', description)
			.canceled(() => {
				debugger
				for (const { mg, hopAlloc } of movementData) {
					hopAlloc?.cancel()
					mg.allocations.source.cancel()
					mg.allocations.target.cancel()
					mg.finish()
				}
			})
			.finished(() => {
				// Complete all movements
				for (const { mg, moving, hopAlloc, hop } of movementData) {
					const nextStorage = hive.storageAt(hop)

					moving.remove()
					if (!mg.path.length) {
						mg.allocations.target.fulfill()
					} else {
						hopAlloc!.fulfill()
						mg.allocations.source = nextStorage!.reserve(
							{ [mg.goodType]: 1 },
							{
								type: 'convey.path',
								movement: mg,
							},
						)
					}
				}
			})
			.final(() => {
				for (const { moving } of movementData) {
					if (!moving.isRemoved) debugger
				}
			})
	}
	@contract()
	harvestStep() {
		const unbuiltLand = this[subject].tile.content as UnBuiltLand
		assert(unbuiltLand instanceof UnBuiltLand, 'tile.content must be an UnBuiltLand')
		const alveolus = this[subject].assignedAlveolus as Ssh.AlveolusDefinition<Ssh.HarvestingAction>
		assert(alveolus, 'assignedAlveolus must be set')
		assert(alveolus.action.type === 'harvest', 'assignedAlveolus.action must be a harvest')
		const action = alveolus.action as Ssh.HarvestingAction
		assert(
			action.deposit === unbuiltLand.deposit?.name,
			'assignedAlveolus.action.deposit must be the same as tile.content.deposit.name',
		)
		const deposit = unbuiltLand.deposit!
		// Check if character can store any of the output goods
		const outputGoods = alveolus.action.output
		const canStoreAny = Object.keys(outputGoods).some(
			(goodType) => this[subject].carry.hasRoom(goodType as GoodType) > 0,
		)
		if (!canStoreAny) return
		deposit.amount -= 1
		if (deposit.amount <= 0) unbuiltLand.deposit = undefined
		return new DurationStep(
			this[subject].assignedAlveolus!.workTime,
			'work',
			`harvest.${this[subject].assignedAlveolus!.name}`,
		).finished(() => {
			// Add all output goods to character inventory
			Object.entries(alveolus.action.output).forEach(([goodType, qty]) => {
				this[subject].carry.addGood(goodType as GoodType, qty)
			})
		})
	}
	@contract()
	transformStep() {
		const alveolus = this[subject].assignedAlveolus as TransformAlveolus
		assert(alveolus, 'assignedAlveolus must be set')
		assert(alveolus.action.type === 'transform', 'assignedAlveolus.action must be a transform')
		const action = alveolus.action
		const allocations: AllocationBase[] = []
		const inputAllocation = alveolus.storage.reserve(action.inputs as Goods, {
			type: 'transform.input',
			alveolus,
			inputs: action.inputs,
		})
		allocations.push(inputAllocation)

		const outputAllocation = alveolus.storage.allocate(action.output as Goods, {
			type: 'transform.output',
			alveolus,
			output: action.output,
		})
		allocations.push(outputAllocation)
		return new DurationStep(alveolus.workTime, 'work', `transform.${alveolus.name}`)
			.finished(() => {
				for (const allocation of allocations) allocation.fulfill()
			})
			.canceled(() => {
				for (const allocation of allocations) allocation.cancel()
			})
	}
	@contract()
	defragmentStep() {
		const character = this[subject]
		const alveolus = character.assignedAlveolus as StorageAlveolus
		assert(alveolus.action.type === 'storage', 'assignedAlveolus must be a StorageAlveolus')
		const fragmentedGoodType = alveolus.storage.fragmented
		assert(fragmentedGoodType, 'alveolus must be fragmented')
		const take = alveolus.storage.allocate({ [fragmentedGoodType]: 1 }, { type: 'defragment.take' })
		const arrange = alveolus.storage.reserve(
			{ [fragmentedGoodType]: 1 },
			{ type: 'defragment.arrange' },
		)
		return new DurationStep(character.vehicle.transferTime, 'work', `defragment.${alveolus.name}`)
			.finished(() => {
				take.fulfill()
				arrange.fulfill()
			})
			.canceled(() => {
				take.cancel()
				arrange.cancel()
			})
	}
	@contract()
	foundationStep() {
		// Character must be on an UnBuiltLand tile with a project
		const content = this[subject].tile.content
		assert(content instanceof UnBuiltLand, 'Tile must be UnBuiltLand')
		assert(content.project, 'UnBuiltLand must have a project')

		// Extract the alveolus type from project (e.g., "build:sawmill" -> "sawmill")
		const alveolusType = content.project.replace('build:', '')

		return new DurationStep(3, 'work', 'foundation').finished(() => {
			// Create BuildAlveolus
			const buildAlveolus = new BuildAlveolus(content.tile, alveolusType as any)
			content.tile.content = buildAlveolus
		})
	}

	@contract()
	constructionStep() {
		// Character must already be on the construction site tile
		const content = this[subject].tile.content
		assert(content instanceof BuildAlveolus, 'Tile must be a BuildAlveolus')
		const site = content as BuildAlveolus
		assert(site.isReady, 'Construction site must be ready')
		const targetType = site.target as keyof typeof alveolusClass
		const TargetClass = alveolusClass[targetType]
		assert(TargetClass, 'Target alveolus class must exist')
		return new DurationStep(
			alveoli[targetType].construction.time,
			'work',
			`construct.${targetType}`,
		).finished(() => {
			// Replace the tile content with the target alveolus
			site.tile.content = new TargetClass(site.tile)
		})
	}
}

export { WorkFunctions }
