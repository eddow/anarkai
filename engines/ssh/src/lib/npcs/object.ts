import { memoize, reactive, unreactive } from 'mutts'
import type { ExecutionContext } from 'npc-script'
import { assert, traces } from 'ssh/debug'
import {
	releaseVehicleFreightWorkOnPlanInterrupt,
	type VehicleFreightInterruptSubject,
} from 'ssh/freight/vehicle-run'
import type { Game, GameObject, TickedGameObject, withTicked } from 'ssh/game'
import {
	loopEntriesForNpcTrace,
	npcSubjectSnapshot,
	plannerSnapshotsFromSubject,
	summarizeScriptExecutionForInfiniteFail,
	summarizeScriptRunValueKind,
} from './npc-diagnostics'
import { getGameScript, ScriptExecution } from './scripts'
import { ASingleStep, PonderingStep, stepPassesFullRemainingOnComplete } from './steps'

function currentStepExecutor(target: { stepExecutor?: ASingleStep }): ASingleStep | undefined {
	return target.stepExecutor
}

function debugStepSnapshot(step: ASingleStep | undefined) {
	if (!step) return undefined
	const serialized = (() => {
		try {
			return step.serialize()
		} catch (error) {
			return {
				serializeError: error instanceof Error ? error.message : String(error),
			}
		}
	})()
	return {
		type: step.constructor.name,
		status: step.status,
		description: step.description,
		fullRemainingOnComplete: stepPassesFullRemainingOnComplete(step.constructor),
		serialized,
	}
}

function assertScriptExecution(value: unknown, context: string): asserts value is ScriptExecution {
	if (value instanceof ScriptExecution) return
	throw new Error(
		`${context} must be a ScriptExecution, got ${value instanceof Function ? value.toString() : String(value)}`
	)
}

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
					if (!firstAction) return
					if (firstAction instanceof ASingleStep) {
						this.stepExecutor = firstAction
						this.nextStep()
					} else {
						this.begin(firstAction)
					}
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
		abstract findAction(): ScriptExecution | ASingleStep | undefined

		@memoize
		get actionDescription(): string[] {
			return this.runningScripts.map((s) => s.name).reverse()
		}
		makeRun() {
			try {
				if (!this.runningScript.state) {
					console.warn(
						'Script finished but still in runningScripts, removing',
						this.runningScript.name
					)
					this.runningScripts.shift()
					return { type: 'return', value: undefined }
				}
				// Validate scriptsContext before running
				if (!this.scriptsContext) {
					console.error('[makeRun] scriptsContext is undefined!', {
						character: (this as any).name ?? (this as any).uid,
						runningScript: this.runningScript.name,
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
							availableKeys: Object.keys(this.scriptsContext),
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
				if (nextAction) {
					if (nextAction instanceof ASingleStep) {
						this.stepExecutor = nextAction
					} else {
						assertScriptExecution(nextAction, 'findAction result')
						this.runningScripts.unshift(nextAction)
					}
				}
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
					this.runningScripts = []
					this.stepExecutor = new PonderingStep(this as any, 0.25)
					return
				}
				if (type === 'return') this.runningScripts.shift()
				if (value) {
					reentered = false
					if (value instanceof ScriptExecution) this.runningScripts.unshift(value)
					else if (value instanceof ASingleStep) {
						this.stepExecutor = value
						//console.log(`[nextStep] ${this.name}: new stepExecutor set: ${value.constructor.name}`);
					} else throw new Error(`Unexpected next action: ${value}`)
				} else if (!this.runningScripts.length) {
					const nextAction = this.findAction()
					if (nextAction?.name === executingName) {
						if (reentered) {
							const last = loopCount[loopCount.length - 1] as
								| { name: string; type: string; value: unknown }
								| undefined
							const subject = npcSubjectSnapshot(this)
							const planner = plannerSnapshotsFromSubject(this)
							const context = {
								subject,
								executingName,
								lastMakeRun: last
									? {
											type: last.type,
											valueKind: summarizeScriptRunValueKind(last.value),
										}
									: undefined,
								nextAction: nextAction
									? summarizeScriptExecutionForInfiniteFail(nextAction)
									: undefined,
								planner,
							}
							console.error(
								`Action infinite fail: ${executingName} returned immediately and was selected again.`,
								context
							)
							traces.npc?.log?.('nextStep.infiniteFail', {
								...context,
								loopTail: loopEntriesForNpcTrace(loopCount, 5),
							})
							this.stepExecutor = new PonderingStep(this as any, 0.25)
							return
						}
						reentered = true
					}
					if (nextAction) {
						if (nextAction instanceof ASingleStep) {
							this.stepExecutor = nextAction
						} else {
							assertScriptExecution(nextAction, 'findAction result')
							//console.log(`[nextStep] ${this.name}: found new action via findAction: ${nextAction.name}`);
							this.runningScripts.unshift(nextAction)
						}
					}
				}
			}
			if (loopCount.length >= 100) throw new Error('nextStep loop count limit exceeded')
		}

		update(dt: number) {
			// If we're in a long ponder/rest step but already standing on a legal wild offload tile with
			// stock in active transport, prefer draining the buffer now — `findAction` won't run until the
			// ponder step completes, which can stall gameplay/tests for a long time.
			if (
				this.stepExecutor instanceof PonderingStep ||
				this.stepExecutor?.constructor?.name === 'PonderingStep'
			) {
				const subject = this as unknown as {
					maybeTransportOffloadDrain?: () => ScriptExecution | false
				}
				const drain = subject.maybeTransportOffloadDrain?.()
				if (drain) {
					this.stepExecutor.cancel()
					this.stepExecutor = undefined
					if (drain instanceof ASingleStep) {
						this.stepExecutor = drain
					} else {
						assertScriptExecution(drain, 'maybeTransportOffloadDrain result')
						this.begin(drain)
					}
					return
				}
			}

			let remaining: number | undefined = dt
			let uselessStepExecutor: Function | undefined
			while (remaining !== undefined && this.stepExecutor) {
				const previousStepExecutor = this.stepExecutor
				const previousStepBeforeTick = debugStepSnapshot(previousStepExecutor)
				const newRemaining = previousStepExecutor.tick(remaining)
				if (typeof newRemaining === 'number' && !Number.isFinite(newRemaining)) debugger
				if (
					newRemaining === remaining &&
					previousStepExecutor &&
					!stepPassesFullRemainingOnComplete(previousStepExecutor.constructor)
				)
					uselessStepExecutor = previousStepExecutor.constructor
				remaining = newRemaining
				if (remaining !== undefined) {
					assert(previousStepExecutor.status !== 'pending', 'Step executor is not pending')
					//console.log(`[update] ${this.name}: finished step ${previousStepExecutor.constructor.name}, remaining dt ${remaining}`);
					this._lastCompletedStepType = previousStepExecutor.constructor.name
					this.stepExecutor = undefined
					this.nextStep()
					const repeatedStepExecutor = currentStepExecutor(this)
					const newType = repeatedStepExecutor?.constructor
					if (uselessStepExecutor && repeatedStepExecutor && uselessStepExecutor === newType) {
						console.error('Useless step executor detected:', {
							object: (this as any).name ?? (this as any).uid ?? 'unknown',
							dt,
							remainingBeforeTick: remaining,
							newRemaining,
							stepType: newType?.name,
							previousStepBeforeTick,
							previousStepAfterTick: debugStepSnapshot(previousStepExecutor),
							repeatedStep: debugStepSnapshot(repeatedStepExecutor),
							lastCompletedStepType: this._lastCompletedStepType,
							runningScripts: this.runningScripts.map((s) => ({
								name: s.name,
								state: s.state,
							})),
							actionDescription: this.actionDescription,
						})
						// Cancel the stuck step to trigger cleanup callbacks and prevent allocation leaks
						repeatedStepExecutor.cancel()
						this.stepExecutor = undefined
						throw new Error(`Useless step executor: ${newType.name}`)
					}
				}
			}
		}
		begin(exec: ScriptExecution) {
			if (this.stepExecutor) throw new Error('Cannot begin a new script while another is running')
			assertScriptExecution(exec, 'begin() argument')
			this.runningScripts.unshift(exec)
			this.nextStep()
		}
		abandonAnd(exec: ScriptExecution | ASingleStep) {
			if (this.stepExecutor) this.stepExecutor.cancel()
			for (const script of this.runningScripts) script.cancel(this.scriptsContext)
			this.runningScripts.splice(0, this.runningScripts.length)
			this.stepExecutor = undefined
			releaseVehicleFreightWorkOnPlanInterrupt(this as unknown as VehicleFreightInterruptSubject)
			if (exec instanceof ASingleStep) {
				this.stepExecutor = exec
				this.nextStep()
			} else {
				assertScriptExecution(exec, 'abandonAnd() argument')
				this.begin(exec)
			}
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
			if (!this.runningScripts.length) {
				releaseVehicleFreightWorkOnPlanInterrupt(this as unknown as VehicleFreightInterruptSubject)
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
					data.stepExecutor
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
							console.warn(
								`Could not find GameScript for file: ${s.scriptFileName}. Skipping script restoration.`
							)
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
