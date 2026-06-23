import { reactive, unreactive } from 'mutts'
import type { ExecutionContext } from 'npc-script'
import {
	releaseVehicleFreightWorkOnPlanInterrupt,
	type VehicleFreightInterruptSubject,
} from 'ssh/freight/vehicle-run'
import type { Game, GameObject } from 'ssh/game'
import type { Clock, Clocked } from 'ssh/utils/clock'
import { traces } from '../dev/debug.ts'
import {
	loopEntriesForNpcTrace,
	npcSubjectSnapshot,
	plannerSnapshotsFromSubject,
	summarizeScriptExecutionForInfiniteFail,
	summarizeScriptRunValueKind,
} from './npc-diagnostics'
import { getGameScript, ScriptExecution, scriptExecutionErrorDiagnostic } from './scripts'
import { AEvolutionStep, ASingleStep, PonderingStep, type TextKey } from './steps'

function assertScriptExecution(value: unknown, context: string): asserts value is ScriptExecution {
	if (value instanceof ScriptExecution) return
	throw new Error(
		`${context} must be a ScriptExecution, got ${value instanceof Function ? value.toString() : String(value)}`
	)
}

export function withScripted<T extends abstract new (...args: any[]) => GameObject>(Base: T) {
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
						this.beginStep(firstAction)
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

		get actionDescription(): string[] {
			// `runningScripts` is intentionally `@unreactive`; keep this as a fresh diagnostic snapshot.
			return this.runningScripts
				.map((script) => script?.name)
				.filter((name): name is string => !!name)
				.reverse()
		}
		get actionDescriptionKeys(): TextKey[] {
			// `runningScripts` is intentionally `@unreactive`; keep this as a fresh UI snapshot.
			return this.runningScripts
				.map((script) => script?.descriptionKey)
				.filter((key): key is TextKey => !!key)
				.reverse()
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
				const diagnostic = {
					subject: npcSubjectSnapshot(this),
					error:
						scriptExecutionErrorDiagnostic(error) ??
						(error instanceof Error
							? { message: error.message, stack: error.stack }
							: { message: String(error) }),
					runningScripts: this.runningScripts.map((script) =>
						summarizeScriptExecutionForInfiniteFail(script)
					),
				}
				traces.script.error?.('script.makeRun.error', diagnostic)
				throw error
			}
		}
		/**
		 * Schedule a timed step on the game clock, or register off-clock.
		 * Sets onComplete to trigger nextStep() when the step finishes.
		 *
		 * @internal — public only because TS disallows private on exported mixins.
		 */
		beginStep(step: ASingleStep): void {
			const gameClock = (this as unknown as { game: { clock: Clock } }).game.clock
			step.onComplete = () => {
				this.stepExecutor = undefined
				this.nextStep()
				if (this.stepExecutor) this.beginStep(this.stepExecutor)
			}
			// Wire game reference so Clocked.remainingDs works
			;(step as { game?: Game }).game = (this as unknown as { game: Game }).game
			if (step instanceof AEvolutionStep) {
				// Timed step: clock drives progress & completion
				gameClock.begin(step as unknown as Clocked, step.duration)
			} else {
				// Off-clock step (QueueStep, WaitForPredicateStep): externally completed
				gameClock.begin(step as unknown as Clocked)
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
					} else throw new Error(`Unexpected next action: ${value}`)
				} else if (!this.runningScripts.length) {
					const nextAction = this.findAction()
					if (nextAction instanceof ScriptExecution && nextAction.name === executingName) {
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
							traces.npc.log?.('nextStep.infiniteFail', {
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

		begin(exec: ScriptExecution) {
			if (this.stepExecutor) throw new Error('Cannot begin a new script while another is running')
			assertScriptExecution(exec, 'begin() argument')
			this.runningScripts.unshift(exec)
			this.nextStep()
			if (this.stepExecutor) this.beginStep(this.stepExecutor)
		}
		abandonAnd(exec: ScriptExecution | ASingleStep) {
			if (this.stepExecutor) {
				this.stepExecutor.cancel('abandon')
				;(this as unknown as { game: { clock: Clock } }).game.clock.remove(
					this.stepExecutor as unknown as Clocked
				)
			}
			for (const script of this.runningScripts) script.cancel(this.scriptsContext)
			this.runningScripts.splice(0, this.runningScripts.length)
			this.stepExecutor = undefined
			releaseVehicleFreightWorkOnPlanInterrupt(this as unknown as VehicleFreightInterruptSubject)
			if (exec instanceof ASingleStep) {
				this.stepExecutor = exec
				this.beginStep(exec)
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
			if (this.stepExecutor) {
				this.stepExecutor.cancel('destroy')
				;(this as unknown as { game: { clock: Clock } }).game.clock.remove(
					this.stepExecutor as unknown as Clocked
				)
			}
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

export type ScriptedObject = InstanceType<ReturnType<typeof withScripted<typeof GameObject>>>
