import { defineProject } from 'vitest/config'

export default defineProject({
	test: {
		environment: 'node',
		globals: true,
		include: ['tests/**/*.{test,spec}.ts'],
		watch: false,
		passWithNoTests: true,
	},
})
