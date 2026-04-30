import { spawn } from 'node:child_process'

const forwardedArgs = process.argv.slice(2).filter((arg, index) => !(arg === '--' && index === 0))
const vitestArgs = ['vitest', 'run', '--silent', '--reporter=dot', ...forwardedArgs]

const child = spawn('pnpm', vitestArgs, {
	cwd: process.cwd(),
	stdio: 'inherit',
})

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal)
		return
	}
	process.exit(code ?? 1)
})
