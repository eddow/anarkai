import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sursautCorePlugin } from '@sursaut/core/plugin'
import { serveRulesAssets } from 'engine-rules/vite-plugins'
import { defineConfig } from 'vite'

const projectRootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [
		sursautCorePlugin({
			projectRoot: projectRootDir,
			onlyRemoveTypeImports: true,
		}),
		// Serves engine-rules assets (goods/building icons, …) at /rules-assets/.
		serveRulesAssets(),
	],
	resolve: {
		alias: {
			'@atlas': resolvePath(projectRootDir, 'src'),
		},
		preserveSymlinks: false,
	},
	server: {
		port: 5371,
		fs: {
			allow: ['..', '../../..'],
		},
	},
	oxc: {
		target: 'es2023',
	},
	optimizeDeps: {
		rolldownOptions: {
			transform: {
				target: 'es2023',
			},
		},
	},
})
