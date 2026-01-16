import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { babelPluginJsxReactive } from 'pounce-ts/plugin'
import { pureGlyfPlugin } from 'pure-glyf/plugin'
import { defineConfig, type Plugin } from 'vite'
import babel from 'vite-plugin-babel'
import { servePixiAssets } from 'engine-pixi/vite-plugins'
import { getCommonAliases, commonOptimizeDeps, commonEsbuild } from 'engine-pixi/vite-config'
import { cssTagPlugin } from '../../engines/ssh/vite-plugin-css-tag'

const projectRootDir = dirname(fileURLToPath(import.meta.url))

function stripDeclare(): Plugin {
	return {
		name: 'strip-declare',
		enforce: 'pre',
		transform(code, id) {
			if (!/\.[cm]?tsx?$/.test(id)) return null

			// Replace `declare field: Type;` with `field!: Type;`
			return code.replace(/\bdeclare\s+([\w[].+?):/g, '$1!:')
		},
	}
}

void stripDeclare

export default defineConfig({
	plugins: [
		pureGlyfPlugin({
			icons: {
				mdi: 'node_modules/@mdi/svg/svg',
				tabler: 'node_modules/@tabler/icons/icons',
			},
			dts: 'src/pure-glyf-icons.d.ts',
		}),
		//stripDeclare(),
		cssTagPlugin(),
		servePixiAssets(),
		babel({
			// Babel config (applied to both JS and TS files)
			babelConfig: {
				plugins: [
					babelPluginJsxReactive,
					// Decorators (legacy or new syntax, configure as needed)
					['@babel/plugin-proposal-decorators', { legacy: true }],

					[
						'@babel/plugin-transform-react-jsx',
						{ pragma: 'h', pragmaFrag: 'Fragment', throwIfNamespace: false },
					],
				],
				overrides: [
					{
						test: /\.[mc]?tsx$/,
						plugins: [
							[
								'@babel/plugin-transform-typescript',
								{ isTS: true, isTSX: true, allowDeclareFields: true },
							],
						],
					},
					{
						test: /\.[mc]?ts$/,
						exclude: /\.[mc]?tsx$/,
						plugins: [
							['@babel/plugin-transform-typescript', { isTS: true, allowDeclareFields: true }],
						],
					},
				],
			},
			// Optional: Extend Babel config for specific file types
			filter: (id) => /\.[cm]?tsx?$/.test(id),
		}),
	],
	resolve: {
		alias: {
			...getCommonAliases(projectRootDir),
			'@app': resolvePath(projectRootDir, 'src'),
			'@pounce': resolvePath(projectRootDir, 'node_modules/pounce-ts/src'),
			'@picocss/pico': resolvePath(projectRootDir, '../../node_modules/.pnpm/@picocss+pico@2.1.1/node_modules/@picocss/pico'),

			'dockview-core': resolvePath(projectRootDir, '../../node_modules/.pnpm/dockview-core@4.12.0/node_modules/dockview-core'),
		},
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
	esbuild: commonEsbuild,
	optimizeDeps: {
		esbuildOptions: {
			...commonEsbuild,
			alias: {
				...getCommonAliases(projectRootDir),
				'@app': resolvePath(projectRootDir, 'src'),
			},
		},
		...commonOptimizeDeps
	},
})
