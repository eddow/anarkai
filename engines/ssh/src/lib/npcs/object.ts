import { memoize, reactive, unreactive } from 'mutts'
import type { ExecutionContext } from 'npc-script'
import { assert } from '$lib/debug'
import type { Game, GameObject, TickedGameObject, withTicked } from '$lib/game'
import { ScriptExecution, getGameScript } from './scripts'
import { ASingleStep } from './steps'

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
                if (!this.runningScript.state) {
                    console.warn('Script finished but still in runningScripts, removing', this.runningScript.name);
                    this.runningScripts.shift();
                    return { type: 'return', value: undefined };
                }
				// Validate scriptsContext before running
				if (!this.scriptsContext) {
					console.error('[makeRun] scriptsContext is undefined!', {
						character: (this as any).name ?? (this as any).uid,
						runningScript: this.runningScript.name
					})
					throw new Error('scriptsContext is undefined')
				}
				// Check for critical namespaces
				const criticalNamespaces = ['inventory', 'walk', 'find', 'work', 'selfCare', 'plan']
				for (const ns of criticalNamespaces) {
					if (!(ns in this.scriptsContext)) {
						console.error(`[makeRun] scriptsContext missing namespace: ${ns}`, {
							character: (this as any).name ?? (this as any).uid,
							runningScript: this.runningScript.name,
							availableKeys: Object.keys(this.scriptsContext)
						})
						throw new Error(`scriptsContext missing namespace: ${ns}`)
					}
				}
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
				//console.log(`[nextStep] ${this.name}: running ${executingName}, produced ${type} with value ${value?.constructor.name || value}`);
				loopCount.push({ name: executingName, type, value })
				if (loopCount.length > 50) {
					console.error('High loop count in nextStep, throttling', executingName, type, value)
					// throw new Error(`High loop count in nextStep: ${executingName}`)
					this.stepExecutor = undefined
					this.runningScripts = [] // Stop all scripts
					return
				}
				if (type === 'return') this.runningScripts.shift()
				if (value) {
					reentered = false
					if (value instanceof ScriptExecution) this.runningScripts.unshift(value)
					else if (value instanceof ASingleStep) {
						this.stepExecutor = value
						//console.log(`[nextStep] ${this.name}: new stepExecutor set: ${value.constructor.name}`);
					}
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
					if (nextAction) {
						//console.log(`[nextStep] ${this.name}: found new action via findAction: ${nextAction.name}`);
						this.runningScripts.unshift(nextAction)
					}
				}
			}
			if (loopCount.length >= 100) throw new Error('nextStep loop count limit exceeded')
		}

		update(dt: number) {
			let remaining: number | undefined = dt
			let uselessStepExecutor: Function | false = false
			while (remaining !== undefined && this.stepExecutor) {
				const newRemaining = this.stepExecutor.tick(remaining)
				if (typeof newRemaining === 'number' && !Number.isFinite(newRemaining)) debugger
				if (newRemaining === remaining && this.stepExecutor)
					uselessStepExecutor = this.stepExecutor.constructor
				remaining = newRemaining
				if (remaining !== undefined) {
					assert(this.stepExecutor.status !== 'pending', 'Step executor is not pending')
					//console.log(`[update] ${this.name}: finished step ${this.stepExecutor.constructor.name}, remaining dt ${remaining}`);
					this.stepExecutor = undefined
					this.nextStep()
					const newType = this.stepExecutor!?.constructor
					if (uselessStepExecutor === newType) {
						console.error('Useless step executor detected:', {
							object: (this as any).name ?? (this as any).uid ?? 'unknown',
							stepType: newType?.name,
							runningScripts: this.runningScripts.map((s) => ({ name: s.name, state: s.state })),
							actionDescription: this.actionDescription,
						})
						throw new Error(`Useless step executor: ${newType.name}`)
					}
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

		public getScriptState() {
			return {
				runningScripts: this.runningScripts.map((s) => ({
					scriptFileName: s.script.name, // The name of the GameScript module (e.g., 'work')
					executionName: s.name, // The name of the function being executed (e.g., 'goWork')
					state: s.state,
				})),
				stepExecutor: this.stepExecutor?.serialize(),
			}
		}

		public restoreScriptState(data: { runningScripts: any[]; stepExecutor?: any }) {
			// Restore step executor
			if (data.stepExecutor) {
				const step = ASingleStep.deserialize(
					this.game as unknown as Game,
					this as unknown as any,
					data.stepExecutor,
				)
				if (step) this.stepExecutor = step
			}

			// Restore running scripts
			if (data.runningScripts) {
				const scriptsList = Array.isArray(data.runningScripts) 
                    ? data.runningScripts 
                    : Object.values(data.runningScripts)

				this.runningScripts = scriptsList
					.map((s: any) => {
						const gameScript = getGameScript(s.scriptFileName)
                        if (!gameScript) {
							console.warn(`Could not find GameScript for file: ${s.scriptFileName}. Skipping script restoration.`)
							return null
						}
						// Assuming ScriptExecution has a constructor compatible
						return new ScriptExecution(gameScript, s.executionName, s.state)
					})
					.filter((s) => s) as ScriptExecution[]
			}
		}

	}
	return ScriptedMixin
}

export type ScriptedObject = InstanceType<
	ReturnType<typeof withScripted<ReturnType<typeof withTicked<typeof GameObject>>>>
>
