import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	resolve: {
		alias: [
			{
				find: 'engine-terrain/hex',
				replacement: path.resolve(__dirname, '../terrain/src/hex/index.ts'),
			},
			{
				find: 'engine-terrain',
				replacement: path.resolve(__dirname, '../terrain/src/index.ts'),
			},
			{
				find: 'ssh/assets',
				replacement: path.resolve(__dirname, '../ssh/assets'),
			},
			{
				find: 'ssh',
				replacement: path.resolve(__dirname, '../ssh/src/lib'),
			},
			{
				find: '@app/lib/interactive-state',
				replacement: path.resolve(
					__dirname,
					'../../apps/browser/src/lib/interactive-state.ts',
				),
			},
		],
	},
	test: {
		environment: 'node',
	},
})
