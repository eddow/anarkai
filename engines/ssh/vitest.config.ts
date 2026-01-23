import { mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig as any, {
	test: {
		environment: 'node',
		globals: true,
		setupFiles: ['./test-setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
		exclude: ['node_modules', 'dist', '.git', '.cache', 'tests/e2e'],
		watch: false,
	},
	esbuild: {
		target: 'node14',
	},
})
