import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		include: ['tests/**/*.{test,spec}.ts'],
		watch: false,
	},
	resolve: {
		alias: {
			terrain: new URL('./src', import.meta.url).pathname,
		},
	},
})
