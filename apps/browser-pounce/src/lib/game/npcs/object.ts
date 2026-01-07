import { memoize, reactive, unreactive } from 'mutts'
import type { ExecutionContext } from 'npc-script/src'
import { assert } from '$lib/debug'
import type { Game } from '../game'
import type { GameObject, TickedGameObject, withTicked } from '../object'
import { ScriptExecution } from './scripts'
import { ASingleStep, DurationStep } from './steps'
import { exec } from 'child_process'

export function withScripted<T extends abstract new (...args: any[]) => TickedGameObject>(Base: T) {
	@unreactive('runningScripts')
	abstract class ScriptedMixin extends Base {
		constructor(...args: any[]) {
			super(...args)
			const game = args[0] as Game
			game.on('gameStart', () => {
				if (this.stepExecutor) return
				try {
					const firstAction = this.findAction()
					if (firstAction) this.begin(firstAction)
				} catch (e) {
					console.warn('Script error on gameStart', e)
				}
			})
		}
		public stepExecutor: ASingleStep | undefined
		public runningScripts: ScriptExecution[] = reactive([])
		get runningScript() {
			return this.runningScripts[0]
		}
		abstract scriptsContext: ExecutionContext
		abstract findAction(): ScriptExecution | undefined

		@memoize
		get actionDescription(): string[] {
			return this.runningScripts.map((s) => s.name).reverse()
		}
		makeRun() {
			try {
				return this.runningScript.run(this.scriptsContext)
			} catch (error) {
				// Present stack trace
				console.error(this.runningScripts.map((s) => [s.name, s.state]))
				if (error instanceof Error) console.error(error.stack)
				throw error
			}
		}
		nextStep() {
			if (this.stepExecutor) throw new Error('Cannot begin a new script while another is running')
			if (!this.runningScripts.length) {
				const nextAction = this.findAction()
				if (nextAction) this.runningScripts.unshift(nextAction)
			}
			let reentered = false
			const loopCount: any[] = []
			while (this.runningScripts.length && !this.stepExecutor) {
				const executingName = this.runningScript.name
				const { type, value } = this.makeRun()
				loopCount.push({ name: executingName, type, value })
				if (loopCount.length > 50) {
					console.warn('High loop count in nextStep, throttling', executingName, type, value)
					this.stepExecutor = new DurationStep(0.016, "idle", "cpu.throttle")
					return
				}
				if (type === 'return') this.runningScripts.shift()
				if (value) {
					reentered = false
					if (value instanceof ScriptExecution) this.runningScripts.unshift(value)
					else if (value instanceof ASingleStep) this.stepExecutor = value
					else throw new Error(`Unexpected next action: ${value}`)
				} else if (!this.runningScripts.length) {
					const nextAction = this.findAction()
					if (nextAction?.name === executingName) {
						if (reentered) {
							console.error(`Action infinite fail: ${executingName} returned immediately and was selected again.`)
							throw new Error(`Action infinite fail/foundAction: ${executingName}`)
						}
						reentered = true
					}
					if (nextAction) this.runningScripts.unshift(nextAction)
				}
			}
			if (loopCount.length >= 100) throw new Error('nextStep loop count limit exceeded')

		}

		update(dt: number) {
			let remaining: number | undefined = dt
			//let uselessStepExecutor: Function | false = false
			while (remaining !== undefined && this.stepExecutor) {
				const newRemaining = this.stepExecutor.tick(remaining)
				if (typeof newRemaining === 'number' && !Number.isFinite(newRemaining)) debugger
				/*if (newRemaining === remaining && this.stepExecutor)
					uselessStepExecutor = this.stepExecutor.constructor*/
				remaining = newRemaining
				if (remaining !== undefined) {
					assert(this.stepExecutor.status !== 'pending', 'Step executor is not pending')
					this.stepExecutor = undefined
					this.nextStep()
					//const newType = this.stepExecutor!?.constructor
					//if (uselessStepExecutor === newType) throw new Error(`Useless step executor: ${newType}`)
				}
			}
		}
		begin(exec: ScriptExecution) {
			if (this.stepExecutor) throw new Error('Cannot begin a new script while another is running')
			this.runningScripts.unshift(exec)
			this.nextStep()
		}
		abandonAnd(exec: ScriptExecution) {
			if (this.stepExecutor) this.stepExecutor.cancel()
			for (const script of this.runningScripts) script.cancel(this.scriptsContext)
			this.runningScripts.splice(0, this.runningScripts.length)
			this.stepExecutor = undefined
			this.begin(exec)
		}

		cancelPlan(plan: any) {
			while (this.runningScripts.length) {
				const cancelling = this.runningScripts.shift()!
				const newState = cancelling.cancel(this.scriptsContext, plan)
				if (newState) {
					cancelling.state = newState
					this.runningScripts.unshift(cancelling)
					break
				}
			}
		}

		destroy() {
			this.stepExecutor?.cancel()
			// Cancel all running scripts to free allocations
			for (const script of this.runningScripts) {
				// We don't care about the state returned by cancel here, we just want to free resources
				script.cancel(this.scriptsContext)
			}
			this.runningScripts = []
			super.destroy()
		}
	}
	return ScriptedMixin
}

export type ScriptedObject = InstanceType<
	ReturnType<typeof withScripted<ReturnType<typeof withTicked<typeof GameObject>>>>
>
