import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { babelPluginJsxReactive } from 'pounce-ts/plugin'
import { cssTagPlugin } from './vite-plugin-css-tag'
import { defineConfig, type Plugin } from 'vite'
import babel from 'vite-plugin-babel'

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
			'@ssh': resolvePath(projectRootDir, 'node_modules/ssh/src'),
			'$lib': resolvePath(projectRootDir, 'node_modules/ssh/src/lib'),
			'$assets': resolvePath(projectRootDir, 'node_modules/ssh/assets'),
			'@app': resolvePath(projectRootDir, 'src'),
			'@pounce': resolvePath(projectRootDir, 'node_modules/pounce-ts/src'),
		},
	},
	esbuild: false,
})
