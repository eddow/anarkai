import fs from 'node:fs'
import path from 'node:path'

const logPath =
	process.env.SSH_VITEST_PROGRESS_LOG ||
	path.resolve(process.cwd(), 'sandbox/logs/vitest-progress.log')
const heartbeatMs = Number(process.env.SSH_VITEST_PROGRESS_HEARTBEAT_MS || 5000)

fs.mkdirSync(path.dirname(logPath), { recursive: true })

const activeModules = new Map()
const activeTests = new Map()

function now() {
	return new Date().toISOString()
}

function rel(file) {
	if (!file) return 'unknown'
	const cwd = process.cwd()
	return path.isAbsolute(file) ? path.relative(cwd, file) || file : file
}

function append(event, details = {}) {
	const line = JSON.stringify({ time: now(), event, ...details })
	fs.appendFileSync(logPath, `${line}\n`)
}

function moduleName(testModule) {
	return rel(testModule?.relativeModuleId || testModule?.moduleId || testModule?.name)
}

function testName(testCase) {
	return testCase?.fullName || testCase?.name || testCase?.id || 'unknown test'
}

function resultState(testCase) {
	try {
		return testCase?.result?.()?.state || 'unknown'
	} catch {
		return 'unknown'
	}
}

function durationMs(testCase) {
	try {
		return testCase?.diagnostic?.()?.duration
	} catch {
		return undefined
	}
}

let heartbeat

export default class ProgressReporter {
	onInit() {
		append('progress-log-created', { logPath })
		heartbeat = setInterval(() => {
			append('heartbeat', {
				activeModules: [...activeModules.values()],
				activeTests: [...activeTests.values()],
			})
		}, heartbeatMs)
		heartbeat.unref?.()
	}

	onTestRunStart(specifications) {
		append('run-start', { specifications: specifications?.length ?? 0 })
	}

	onTestModuleQueued(testModule) {
		append('module-queued', { module: moduleName(testModule) })
	}

	onTestModuleStart(testModule) {
		const module = moduleName(testModule)
		activeModules.set(testModule.id || module, module)
		append('module-start', { module })
	}

	onTestCaseReady(testCase) {
		const module = moduleName(testCase?.module)
		const test = testName(testCase)
		activeTests.set(testCase.id || `${module} > ${test}`, { module, test })
		append('test-start', { module, test })
	}

	onTestCaseResult(testCase) {
		const module = moduleName(testCase?.module)
		const test = testName(testCase)
		activeTests.delete(testCase.id || `${module} > ${test}`)
		append('test-end', {
			module,
			test,
			state: resultState(testCase),
			durationMs: durationMs(testCase),
		})
	}

	onTestModuleEnd(testModule) {
		const module = moduleName(testModule)
		activeModules.delete(testModule.id || module)
		append('module-end', { module })
	}

	onProcessTimeout() {
		append('process-timeout', {
			activeModules: [...activeModules.values()],
			activeTests: [...activeTests.values()],
		})
	}

	onTestRunEnd(_testModules, unhandledErrors, reason) {
		if (heartbeat) clearInterval(heartbeat)
		append('run-end', {
			reason,
			unhandledErrors: unhandledErrors?.length ?? 0,
			activeModules: [...activeModules.values()],
			activeTests: [...activeTests.values()],
		})
	}
}
