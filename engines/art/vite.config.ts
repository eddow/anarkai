import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sursautCorePlugin } from '@sursaut/core/plugin'
import { defineConfig } from 'vite'

const projectRootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [
		sursautCorePlugin({
			projectRoot: projectRootDir,
			onlyRemoveTypeImports: true,
		}),
	],
	resolve: {
		alias: {
			'@art': resolvePath(projectRootDir, 'src'),
		},
		preserveSymlinks: false,
	},
	server: {
		port: 5370,
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
