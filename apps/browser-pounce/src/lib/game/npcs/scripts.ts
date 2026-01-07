import { type } from 'arktype'
import { unreactive } from 'mutts'
import {
	type ExecutionContext,
	ExecutionError,
	type ExecutionState,
	FunctionDefinition,
	NpcScript,
} from 'npc-script/src'
import { alveoli, deposits, goods, terrain } from '$assets/game-content'
import { CharacterContract } from '$assets/scripts/contracts'
import {
	type Contract,
	contract,
	contractScope,
	isContract,
	overloadContract,
	registerContract,
} from '$lib/types'
import { axial, epsilon, objectMap } from '$lib/utils'
import { Positioned, positionRoughly, toAxialCoord } from '$lib/utils/position'
import type { GameObject, InteractiveGameObject } from '../object'
import { gameIsaTypes, gameOperators, lerp } from './utils'

type XOrDictX<X> = X | { [k: string]: XOrDictX<X> }

/*unreactive(MiniScriptExecutor)
unreactive(NpcScript)*/

@unreactive
export class GlobalContext {
	@contract('unknown')
	info(value: any) {
		console.log(value)
	}
	@contract('unknown?')
	debugger(value: any) {
		console.dir(value, { depth: null })
		debugger
	}
	@contract('...', 'unknown[]')
	print(...args: any[]) {
		console.log(...args)
	}
	@contract('string', '...', 'unknown[]')
	error(message: string, ...args: any[]) {
		if (args.length > 0) console.error(...args)
		throw new Error(message)
	}
	// Basic math functions
	@contract('...', 'number[]')
	min(...args: number[]) {
		return Math.min(...args)
	}
	@contract('...', 'number[]')
	max(...args: number[]) {
		return Math.max(...args)
	}
	@contract('number')
	abs(arg: number) {
		return Math.abs(arg)
	}
	@contract('number')
	floor(arg: number) {
		return Math.floor(arg)
	}
	@contract('number')
	ceil(arg: number) {
		return Math.ceil(arg)
	}
	@contract('number', 'number', 'number')
	clamp(value: number, min: number, max: number) {
		return Math.max(min, Math.min(max, value))
	}

	// Interpolation and rounding
	@overloadContract(['number', 'number', 'number'], [Positioned, Positioned, 'number'])
	lerp<T extends number | Positioned>(a: T, b: T, t: number): T {
		return lerp(a, b, t)
	}
	@contract(type.or('number', Positioned))
	round<T extends number | Positioned>(a: T): T {
		if (typeof a === 'number') {
			return Math.round(a) as T
		}
		if (Positioned.allows(a)) {
			const axial = toAxialCoord(a)
			return { q: Math.round(axial.q), r: Math.round(axial.r) } as T
		}
		throw new Error(`Invalid round type: ${typeof a}`)
	}
	@contract(type.or('number', Positioned), 'number?')
	roughly<T extends number | Positioned>(a: T, usedEpsilon = epsilon): T {
		if (typeof a === 'number') {
			return (Math.round(a / usedEpsilon) * usedEpsilon) as T
		}
		if (Positioned.allows(a)) {
			return positionRoughly(a) as T
		}
		throw new Error(`Invalid roughly type: ${typeof a}`)
	}
	@contract('object')
	keys(object: object) {
		return Object.keys(object)
	}
	@contract('object')
	aKey(object: object) {
		const keys = Object.keys(object)
		const rnd = (globalThis as any).__GAME_RANDOM__ as
			| ((max?: number, min?: number) => number)
			| undefined
		if (!rnd) throw new Error('Global RNG not initialized')
		return keys[Math.floor(rnd(keys.length))]
	}
}

export const subject = Symbol('subject')
export function protoCtx<Class extends abstract new () => object, Ext extends object>(
	concept: Class,
	ext?: Ext,
): InstanceType<Class> & Ext {
	const cp = concept.prototype
	delete cp.constructor
	return ext ? Object.setPrototypeOf(ext, cp) : cp
}
export class GameContext<Subject extends GameObject> extends GlobalContext {
	declare [subject]: Subject
	@contract(Positioned)
	tileAt(positioned: Positioned) {
		return this[subject].game.hex.getTile(axial.round(toAxialCoord(positioned)))
	}
}

Object.assign(GameContext.prototype, { terrain, deposits, alveoli, goods })

export class InteractiveContext<
	Subject extends InteractiveGameObject,
> extends GameContext<Subject> {
	get tile() {
		return this[subject].tile
	}
	@contract('...', 'unknown[]')
	log(...args: any[]) {
		this[subject].log(...args)
	}
}

class GameScript extends NpcScript {
	constructor(
		public readonly name: string,
		public readonly fileName: string,
		source: string,
	) {
		super(source, gameOperators, gameIsaTypes)
	}
	callNative(func: any, args: any[], context: ExecutionContext) {
		if (!isContract(func)) throw new Error(`Function ${func.name} is not a contract`)
		return func.apply(context, args)
	}
}

function isXOrDictX<X>(x: XOrDictX<X>, Class: new (...args: any[]) => X): x is XOrDictX<X> {
	return (
		x instanceof Class ||
		(x && typeof x === 'object' && Object.values(x).every((v) => isXOrDictX(v, Class)))
	)
}
@unreactive
export class ScriptExecution {
	constructor(
		public readonly script: GameScript,
		public readonly name: string,
		public state?: ExecutionState,
	) {}
	run(context: ExecutionContext) {
		if (!this.state) throw new Error('ScriptExecution was finished')
		const executor = this.script.executor(context, this.state)
		try {
			const result = executor.execute()
			this.state = result.type === 'yield' ? executor.state : undefined
			return result
		} catch (error) {
			if (error instanceof ExecutionError) {
				console.error(`${this.script.sourceLocation(error.statement)}\n${error.error?.message}`)
				console.error(error.stack)
			}
			throw error
		}
	}
	cancel(context: ExecutionContext, plan?: any) {
		return this.script.cancel(context, this.state!, plan)
	}
}

export function loadNpcScripts(alveoli: Record<string, string>, context: ExecutionContext) {
	const npcScripts = Object.fromEntries(
		Object.entries(alveoli).map(([path, source]) => {
			const name = path
				.split('/scripts/')
				.pop()!
				.match(/(.*)\.npcs$/)?.[1]!
				.replace(/\//g, '.')!
			const gameScript = new GameScript(name, path, source)
			const executed = gameScript.execute(context)
			if (executed.type !== 'return') {
				throw new Error(
					`Script ${gameScript.name} did not return a value. Expected: a function or a map of functions. Got: ${executed.type}`,
				)
			}
			if (!isXOrDictX(executed.value, FunctionDefinition)) {
				throw new Error(
					`Script ${gameScript.name} returned a value that is not a function or a map of functions. Got: ${executed.value}`,
				)
			}
			return [name, { gameScript, value: executed.value }]
		}),
	)

	type XoDe = XOrDictX<(...args: any[]) => ScriptExecution>
	function exposeScripts(
		script: GameScript,
		entryPoint: XOrDictX<FunctionDefinition>,
		name: string,
		contract: Contract,
	): XoDe {
		if (entryPoint instanceof FunctionDefinition && Array.isArray(contract)) {
			const validate = contractScope.type(contract as any)
			return registerContract((...args: any[]) => {
				const result = validate(args)
				if (result instanceof type.errors) {
					throw new Error(`Validation failed for ${name}: ${result.summary}`)
				}
				return new ScriptExecution(script, name, entryPoint.call(args))
			})
		}
		if (!(entryPoint instanceof FunctionDefinition) && !Array.isArray(contract)) {
			return objectMap(entryPoint, (value, key) => {
				const nextName = `${name}.${key}`
				const nextProto = (contract as { [K: string]: Contract })[key]
				return exposeScripts(script, value, nextName, nextProto)
			}) as XoDe
		}
		throw new Error(`Invalid contract type for entry point ${name}: ${typeof contract} ${contract}`)
	}

	for (const [name, { gameScript, value }] of Object.entries(npcScripts)) {
		const exposed = exposeScripts(
			gameScript,
			value,
			name,
			CharacterContract[name as keyof typeof CharacterContract],
		)
		const existing = context[name]
		if (name in context && typeof context[name] === 'object') {
			Object.assign(existing, exposed)
		} else {
			context[name] = exposed
		}
	}
	return context
}
