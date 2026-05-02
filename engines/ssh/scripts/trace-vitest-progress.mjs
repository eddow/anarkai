import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_EXCLUDES = [
	'tests/integration/sample_game.test.ts',
	'tests/integration/assigned_second_wood_debug.test.ts',
	'tests/integration/atomicity_diff.test.ts',
	'tests/integration/convey_bookkeeping_resilience.test.ts',
	'tests/integration/convey_stall.test.ts',
	'tests/integration/gather_to_sawmill_regression.test.ts',
	'tests/integration/mixed_pipeline_stall_regression.test.ts',
	'tests/integration/repro_deadlock.test.ts',
	'tests/integration/reserved_wood_stuck_diagnostic.test.ts',
	'tests/integration/single_worker_two_woods_regression.test.ts',
]

function timestamp() {
	return new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, '')
		.replace('T', '-')
}

function readFlagValue(arg, flag) {
	if (arg === flag) return ''
	const prefix = `${flag}=`
	return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined
}

const rawArgs = process.argv.slice(2).filter((arg, index) => !(arg === '--' && index === 0))
const forwardedArgs = []
let includeDefaultExcludes = true
let traceChannels
let traceLevel

for (let index = 0; index < rawArgs.length; index++) {
	const arg = rawArgs[index]
	if (arg === '--no-default-excludes') {
		includeDefaultExcludes = false
		continue
	}

	const traceValue = readFlagValue(arg, '--trace')
	if (traceValue !== undefined) {
		traceChannels = traceValue || rawArgs[++index]
		continue
	}

	const traceLevelValue = readFlagValue(arg, '--trace-level')
	if (traceLevelValue !== undefined) {
		traceLevel = traceLevelValue || rawArgs[++index]
		continue
	}

	forwardedArgs.push(arg)
}

const runStamp = timestamp()
const logPath = path.resolve(process.cwd(), `sandbox/logs/vitest-progress-${runStamp}.jsonl`)
const outputPath = path.resolve(process.cwd(), `sandbox/logs/vitest-output-${runStamp}.log`)
const reporterPath = path.resolve(process.cwd(), 'scripts/vitest-progress-reporter.mjs')
const hasExplicitSilentFlag = forwardedArgs.some((arg) => arg === '--silent' || arg.startsWith('--silent='))
const vitestArgs = [
	'vitest',
	'run',
	'--reporter=default',
	`--reporter=${reporterPath}`,
]

if (traceChannels && !hasExplicitSilentFlag) vitestArgs.push('--silent=false')

if (includeDefaultExcludes) {
	for (const testFile of DEFAULT_EXCLUDES) {
		vitestArgs.push('--exclude', testFile)
	}
}

vitestArgs.push(...forwardedArgs)

const env = {
	...process.env,
	SSH_VITEST_PROGRESS_LOG: logPath,
}

if (traceChannels) env.SSH_TRACE_CHANNELS = traceChannels
if (traceLevel) env.SSH_TRACE_LEVEL = traceLevel

console.log(`progress log: ${logPath}`)
console.log(`output log: ${outputPath}`)
if (traceChannels) {
	console.log(`trace channels: ${traceChannels} (${traceLevel || process.env.SSH_TRACE_LEVEL || 'log'})`)
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
const output = fs.createWriteStream(outputPath, { flags: 'a' })

const child = spawn('pnpm', vitestArgs, {
	cwd: process.cwd(),
	env,
	stdio: ['inherit', 'pipe', 'pipe'],
})

child.stdout.pipe(output, { end: false })
child.stderr.pipe(output, { end: false })
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)

child.on('exit', (code, signal) => {
	output.end()
	console.log(`progress log: ${logPath}`)
	console.log(`output log: ${outputPath}`)
	if (signal) {
		process.kill(process.pid, signal)
		return
	}
	process.exit(code ?? 1)
})
