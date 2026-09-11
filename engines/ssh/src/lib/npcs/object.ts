import { reactive, unreactive } from 'mutts'
import type { ExecutionContext } from 'npc-script'
import { reviveExecutionState, serializeExecutionState } from 'npc-script'
import {
	releaseVehicleFreightWorkOnPlanInterrupt,
	type VehicleFreightInterruptSubject,
} from 'ssh/freight/vehicle-run'
import type { Game, GameObject } from 'ssh/game'
import type { SaveIndexes } from 'ssh/serialization'
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
import { makeReviveHook, makeSerializeHook, NonResumableScriptStateError } from './serialize'
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
					// Bootstrapping the first action must surface: a broken initial
					// plan would otherwise leave the character idle with no trace.
					traces.script(this).error?.('Script error on gameStart', e)
					throw e
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
					traces.script(this).warn?.(
						'Script finished but still in runningScripts, removing',
						this.runningScript.name
					)
					this.runningScripts.shift()
					return { type: 'return', value: undefined }
				}
				// Validate scriptsContext before running
				if (!this.scriptsContext) {
					traces.script(this).error?.('[makeRun] scriptsContext is undefined!', {
						character: (this as any).name ?? 'unknown',
						runningScript: this.runningScript.name,
					})
					throw new Error('scriptsContext is undefined')
				}
				// Check for critical namespaces
				const criticalNamespaces = ['inventory', 'walk', 'find', 'work', 'selfCare', 'plan']
				for (const ns of criticalNamespaces) {
					if (!(ns in this.scriptsContext)) {
						traces.script(this).error?.(`[makeRun] scriptsContext missing namespace: ${ns}`, {
							character: (this as any).name ?? 'unknown',
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
				traces.script(this).error?.('script.makeRun.error', diagnostic)
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
				// Timed step: clock drives progress & completion. Use the *remaining*
				// duration so a partially-evolved step restored from a save resumes from
				// its current `evolution` instead of restarting (fresh steps have
				// `evolution === 0`, so this is `step.duration` in the normal flow).
				gameClock.begin(step as unknown as Clocked, step.duration * (1 - step.evolution))
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
					// A script spinning without yielding a step is a real bug (infinite
					// loop in script logic). Surface at error level — test diagnostics
					// fail on it unless explicitly allowed — then throttle.
					// NOTE: raw `value` (ScriptExecution/ASingleStep) projects as
					// `$unprojected` in traces, so also emit JSON-safe summaries.
					const subject = npcSubjectSnapshot(this)
					const planner = plannerSnapshotsFromSubject(this)
					traces.npc(this).error?.('High loop count in nextStep, throttling', {
						subject,
						executingName,
						type,
						valueKind: summarizeScriptRunValueKind(value),
						valueSummary:
							value instanceof ScriptExecution
								? summarizeScriptExecutionForInfiniteFail(value)
								: undefined,
						loopTail: loopEntriesForNpcTrace(loopCount, 10),
						runningScripts: this.runningScripts.map((s) =>
							summarizeScriptExecutionForInfiniteFail(s)
						),
						planner,
					})
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
							traces.npc(this).error?.(
								`Action infinite fail: ${executingName} returned immediately and was selected again.`,
								context
							)
							traces.npc(this).log?.('nextStep.infiniteFail', {
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

		public getScriptState(indexes?: SaveIndexes) {
			// Only build the serialize hook when there is an execution state to snapshot.
			const hook =
				indexes && this.runningScripts.some((s) => s.state !== undefined)
					? makeSerializeHook(this.scriptsContext, indexes, this as unknown as object)
					: undefined
			try {
				const runningScripts = this.runningScripts.map((s) => ({
					scriptFileName: s.script.name, // The name of the GameScript module (e.g., 'work')
					executionName: s.name, // The name of the function being executed (e.g., 'goWork')
					// Deep-snapshot the executor state at save time (a live reference would be
					// mutated by the running game after `saveGameData()` returns).
					state:
						s.state !== undefined && hook !== undefined
							? serializeExecutionState(s.state, hook)
							: s.state,
				}))
				return { runningScripts, stepExecutor: this.stepExecutor?.serialize(), resumable: true }
			} catch (error) {
				// A transient host object (loose good / in-flight movement) is expected to be
				// non-resumable — the character re-plans through the normal selection path. Log it
				// at warn level; genuine serialization bugs stay at error level.
				if (error instanceof NonResumableScriptStateError) {
					traces.script(this).warn?.('script.serialize.non-resumable', {
						character: (this as unknown as { name?: string }).name,
						reason: error.message,
					})
				} else {
					traces.script(this).error?.('script.serialize.failed', {
						character: (this as unknown as { name?: string }).name,
						error,
					})
				}
				return { runningScripts: [], stepExecutor: undefined, resumable: false }
			}
		}

		public restoreScriptState(
			data: { runningScripts: any[]; stepExecutor?: any; resumable?: boolean },
			indexes?: SaveIndexes
		) {
			// Restore step executor
			if (data.stepExecutor) {
				const step = ASingleStep.deserialize(
					this.game as unknown as Game,
					this as unknown as any,
					data.stepExecutor
				)
				if (step) this.stepExecutor = step
			}

			// Restore running scripts, reviving the tokenized ExecutionState against the
			// freshly reconstituted context and load-side save indexes.
			if (data.runningScripts) {
				const scriptsList = Array.isArray(data.runningScripts)
					? data.runningScripts
					: Object.values(data.runningScripts)

				const hook =
					indexes && scriptsList.some((s: any) => s.state !== undefined)
						? makeReviveHook(
								this.scriptsContext,
								indexes,
								this.game as unknown as Game,
								this as unknown as object
							)
						: undefined

				try {
					this.runningScripts = scriptsList
						.map((s: any) => {
							const gameScript = getGameScript(s.scriptFileName)
							if (!gameScript) {
								traces.script(this).warn?.(
									`Could not find GameScript for file: ${s.scriptFileName}. Skipping script restoration.`
								)
								return null
							}
							const state =
								s.state !== undefined && hook !== undefined
									? reviveExecutionState(s.state, hook)
									: s.state
							return new ScriptExecution(gameScript, s.executionName, state)
						})
						.filter((s): s is ScriptExecution => s !== null)
				} catch (error) {
					// An unresolvable reference means the script cannot be faithfully resumed.
					traces.script(this).error?.('script.restore.failed', {
						character: (this as unknown as { name?: string }).name,
						error,
					})
					this.runningScripts = []
					this.stepExecutor = undefined
					return
				}
			}

			// Auto-resume the restored execution. A non-resumable state is left idle so the
			// character re-picks work through the normal selection path.
			if (data.resumable === false) return
			if (this.stepExecutor) {
				this.beginStep(this.stepExecutor)
			} else if (this.runningScripts.length) {
				this.nextStep()
				if (this.stepExecutor) this.beginStep(this.stepExecutor)
			}
		}
	}
	return ScriptedMixin
}

export type ScriptedObject = InstanceType<ReturnType<typeof withScripted<typeof GameObject>>>
