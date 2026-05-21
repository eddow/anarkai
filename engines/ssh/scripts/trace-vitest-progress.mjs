import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

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
let traceChannels
let traceLevel
let processTimeoutMs = Number(process.env.SSH_VITEST_PROCESS_TIMEOUT_MS || 0)

for (let index = 0; index < rawArgs.length; index++) {
	const arg = rawArgs[index]
	if (arg === '--default-excludes') {
		console.warn('--default-excludes is deprecated; run the suite with explicit timeouts instead.')
		continue
	}

	const processTimeoutValue = readFlagValue(arg, '--process-timeout-ms')
	if (processTimeoutValue !== undefined) {
		processTimeoutMs = Number(processTimeoutValue || rawArgs[++index] || 0)
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

let timeout
if (Number.isFinite(processTimeoutMs) && processTimeoutMs > 0) {
	timeout = setTimeout(() => {
		const event = {
			time: new Date().toISOString(),
			event: 'parent-process-timeout',
			timeoutMs: processTimeoutMs,
		}
		fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`)
		child.kill('SIGTERM')
	}, processTimeoutMs)
	timeout.unref?.()
}

child.on('exit', (code, signal) => {
	if (timeout) clearTimeout(timeout)
	output.end()
	console.log(`progress log: ${logPath}`)
	console.log(`output log: ${outputPath}`)
	if (signal) {
		process.kill(process.pid, signal)
		return
	}
	process.exit(code ?? 1)
})
