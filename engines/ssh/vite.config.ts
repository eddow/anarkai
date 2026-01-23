import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import babel from 'vite-plugin-babel'
import { cssTagPlugin } from './vite-plugin-css-tag.ts'

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
		//stripDeclare(),
		cssTagPlugin(),
		babel({
			// Babel config (applied to both JS and TS files)
			babelConfig: {
				plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
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
	optimizeDeps: {
		exclude: ['mutts', 'npc-script', 'omni18n', 'ssh'],
	},
	resolve: {
		alias: {
			$lib: resolvePath(projectRootDir, 'src/lib'),
			$components: resolvePath(projectRootDir, 'src/components'),
			$assets: resolvePath(projectRootDir, 'assets'),
			'@app': resolvePath(projectRootDir, 'src'),
			'@ssh': resolvePath(projectRootDir, 'src'),
		},
	},
	esbuild: false,
})
