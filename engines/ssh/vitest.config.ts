import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			'@ssh': resolve(__dirname, './src'),
			$lib: resolve(__dirname, './src/lib'),
			$assets: resolve(__dirname, './assets'),
		},
		preserveSymlinks: false,
	},
	test: {
		environment: 'node',
		globals: true,
		setupFiles: ['./test-setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['node_modules', 'dist', '.git', '.cache'],
		watch: false,
	},
	esbuild: {
		target: 'node14',
	},
})
