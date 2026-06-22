import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const projectRootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		setupFiles: ['./test-setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
		exclude: [
			'node_modules', 'dist', '.git', '.cache', 'tests/e2e',
			// Integration tests — save for thorough suite
			'tests/integration/**',
			// Heavy unit files (>15s each) — save for thorough suite
			'tests/unit/advert_convey_regression.test.ts',
			'tests/unit/construction-site.test.ts',
			'tests/unit/construction-work-step.test.ts',
			'tests/unit/construction-save.test.ts',
			'tests/unit/vehicle-zone-hop.test.ts',
			'tests/unit/vehicle-service-arbitration.test.ts',
			'tests/unit/vehicle-hop-prepare.test.ts',
			'tests/unit/vehicle-freight-dock.test.ts',
			'tests/unit/vehicle-offload-job.test.ts',
			'tests/unit/character-vehicle.test.ts',
			'tests/unit/chopsaw-example.test.ts',
			'tests/unit/chopsaw-viability.test.ts',
			'tests/unit/eating_requirement.test.ts',
		],
		testTimeout: 5000,
		hookTimeout: 10000,
		teardownTimeout: 10000,
		silent: true,
		pool: 'threads',
		fileParallelism: false,
	},
	oxc: {
		target: 'node14',
		decorator: { legacy: true },
	},
	resolve: {
		alias: [
			{ find: /^engine-terrain\/hex$/,       replacement: resolvePath(projectRootDir, '../terrain/src/hex/index.ts') },
			{ find: /^engine-terrain$/,             replacement: resolvePath(projectRootDir, '../terrain/src/index.ts') },
			{ find: /^ssh\/debug-game-state$/,      replacement: resolvePath(projectRootDir, 'src/lib/dev/debug-game-state.ts') },
			{ find: /^ssh\/(.*)$/,                  replacement: `${resolvePath(projectRootDir, 'src/lib')}/$1` },
			{ find: /^ssh$/,                        replacement: resolvePath(projectRootDir, 'src/lib') },
			{ find: /^npc-script$/,                 replacement: resolvePath(projectRootDir, '../../../ownk/npcs/src') },
			{ find: /^mutts$/,                      replacement: resolvePath(projectRootDir, '../../../ownk/mutts') },
		],
	},
})
