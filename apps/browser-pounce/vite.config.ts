import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commonEsbuild, commonOptimizeDeps } from 'engine-pixi/vite-config'
import { servePixiAssets } from 'engine-pixi/vite-plugins'
import { pounceCorePlugin, pounceBarrelPlugin } from '@pounce/core/plugin'
import { pureGlyfPlugin } from '../../../ownk/pounce/packages/pure-glyf/dist/plugin.js'
import { defineConfig, type Plugin } from 'vite'
import { cssTagPlugin } from '../../engines/ssh/vite-plugin-css-tag'

const projectRootDir = dirname(fileURLToPath(import.meta.url))

function stripDeclare(): Plugin {
	return {
		name: 'strip-declare',
		enforce: 'pre',
		transform(code, id) {
			if (!/\.[cm]?tsx?$/.test(id)) return null

			return code.replace(/\bdeclare\s+/g, '')
		},
	}
}

void stripDeclare

const aliases = {
	'@app': resolvePath(projectRootDir, 'src'),
	$lib: resolvePath(projectRootDir, 'src/lib'),
	$assets: resolvePath(projectRootDir, 'assets'),

	// Workspace Packages (Source Mapping)
	'ssh/assets': resolvePath(projectRootDir, '../../engines/ssh/assets'),
	ssh: resolvePath(projectRootDir, '../../engines/ssh/src/lib'),
	'engine-pixi/assets': resolvePath(projectRootDir, '../../engines/pixi/assets'),
	'engine-pixi': resolvePath(projectRootDir, '../../engines/pixi/src'),
	'pure-glyf': resolvePath(projectRootDir, '../../../ownk/pounce/packages/pure-glyf/src'),

	// Fallbacks/Legacy
	mutts: resolvePath(projectRootDir, '../../../ownk/mutts/src'),

	// Fix dockview and picocss resolution
	'@picocss/pico': resolvePath(projectRootDir, 'node_modules/@picocss/pico'),
	'dockview-core': resolvePath(projectRootDir, 'node_modules/dockview-core'),
}

export default defineConfig({
	plugins: [
		pureGlyfPlugin({
			icons: {
				mdi: 'node_modules/@mdi/svg/svg',
				tabler: 'node_modules/@tabler/icons/icons',
			},
			dts: 'src/pure-glyf-icons.d.ts',
		}) as any,
		stripDeclare(),
		cssTagPlugin(),
		servePixiAssets(),
		pounceCorePlugin({
			projectRoot: projectRootDir,
		}),
		pounceBarrelPlugin({
			name: '@pounce',
			skeleton: 'front-end',
			adapter: '@pounce/adapter-pico',
			dts: 'src/@pounce.d.ts',
		}),
	],
	resolve: {
		alias: aliases,
		preserveSymlinks: false,
	},
	server: {
		fs: {
			allow: ['..', '../../..'],
		},
		watch: {
			usePolling: true,
			interval: 1000,
			ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'],
		},
	},
	esbuild: {
		...commonEsbuild,
		target: 'node14',
	},
	optimizeDeps: {
		esbuildOptions: {
			...commonEsbuild,
			alias: aliases,
		},
		...commonOptimizeDeps,
	},
})
