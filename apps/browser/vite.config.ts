import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sursautCorePlugin } from '@sursaut/core/plugin'
import { commonEsbuild, commonOptimizeDeps } from 'engine-pixi/vite-config'
import { servePixiAssets } from 'engine-pixi/vite-plugins'
import { pureGlyfPlugin } from 'pure-glyf/plugin'
import { type Alias, defineConfig, type Plugin, type PluginOption, type UserConfig } from 'vite'
import { cssTagPlugin } from './src/lib/css-tag-plugin'

const projectRootDir = dirname(fileURLToPath(import.meta.url))
const sshAssetsDir = resolvePath(projectRootDir, '../../engines/ssh/assets')
const sshSourceDir = resolvePath(projectRootDir, '../../engines/ssh/src/lib')
const pixiAssetsDir = resolvePath(projectRootDir, '../../engines/pixi/assets')
const pixiSourceDir = resolvePath(projectRootDir, '../../engines/pixi/src')
const picoCssDir = resolvePath(projectRootDir, 'node_modules/@picocss/pico')
const dockviewCoreDir = resolvePath(projectRootDir, 'node_modules/dockview-core')
const muttsBrowserEntry = resolvePath(projectRootDir, 'node_modules/mutts/dist/browser.esm.js')
const pureGlyfIcons = {
	mdi: resolvePath(projectRootDir, 'node_modules/@mdi/svg/svg'),
	tabler: resolvePath(projectRootDir, 'node_modules/@tabler/icons/icons'),
} satisfies Record<string, string>
const sharedAliasPaths = {
	'@app': resolvePath(projectRootDir, 'src'),
	$lib: resolvePath(projectRootDir, 'src/lib'),
	$assets: resolvePath(projectRootDir, 'assets'),
	'ssh/assets': sshAssetsDir,
	ssh: sshSourceDir,
	'engine-pixi/assets': pixiAssetsDir,
	'engine-pixi': pixiSourceDir,
	'@picocss/pico': picoCssDir,
	'dockview-core': dockviewCoreDir,
} satisfies Record<string, string>
const aliases: Alias[] = Object.entries(sharedAliasPaths).map(([find, replacement]) => ({
	find,
	replacement,
}))
aliases.push({ find: 'mutts', replacement: muttsBrowserEntry })
const optimizeAliases = {
	...sharedAliasPaths,
	mutts: muttsBrowserEntry,
} satisfies Record<string, string>
const serverWatchIgnored = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**']
const usePollingWatch = process.env.VITE_USE_POLLING === 'true'
const serverWatchConfig = usePollingWatch
	? {
			usePolling: true,
			interval: 1000,
			ignored: serverWatchIgnored,
		}
	: {
			ignored: serverWatchIgnored,
		}
const pureGlyfPluginOption = pureGlyfPlugin({
	icons: pureGlyfIcons,
	dts: 'src/pure-glyf-icons.d.ts',
}) as unknown as PluginOption

function stripDeclare(): Plugin {
	// Ambient declaration keywords that must NOT be stripped
	const ambientKeywords =
		/^(module|namespace|class|function|var|let|const|enum|abstract|interface|type|global)\b/

	return {
		name: 'strip-declare',
		enforce: 'pre',
		transform(code, id) {
			if (!/\.[cm]?tsx?$/.test(id)) return null
			if (id.includes('node_modules')) return null
			if (!code.includes('declare ')) return null

			// Only strip declare from ssh engine files.
			// The npcs parser files use 'declare block:' to prevent class field
			// initializers from overriding the parent constructor — these are handled
			// correctly by babelPluginTs allowDeclareFields:true and must NOT be stripped.
			// The ssh engine files have decorated classes where the Babel decorators
			// plugin (running before babelPluginTs) rejects 'declare' fields outright.
			if (!id.includes('/engines/ssh/')) return null

			const result = code.replace(/\bdeclare\s+(?=[a-zA-Z_$[])/g, (match, offset) => {
				const after = code.slice(offset + match.length)
				if (ambientKeywords.test(after)) return match
				return ''
			})

			return result !== code ? result : null
		},
	}
}

export const browserViteConfig: UserConfig = {
	plugins: [
		stripDeclare(), // Must run first, before Babel
		pureGlyfPluginOption,
		cssTagPlugin(),
		servePixiAssets(),
		sursautCorePlugin({
			projectRoot: projectRootDir,
			onlyRemoveTypeImports: true,
		}),
	],
	resolve: {
		alias: aliases,
		preserveSymlinks: false,
		dedupe: ['mutts', '@sursaut/core', '@sursaut/kit'],
	},
	build: {
		rolldownOptions: {
			output: {
				keepNames: true,
			},
		},
	},
	server: {
		port: 5360,
		fs: {
			allow: ['..', '../../..'],
		},
		watch: serverWatchConfig,
	},
	oxc: {
		target: commonEsbuild.target,
		decorator: {
			legacy: commonEsbuild.tsconfigRaw.compilerOptions.experimentalDecorators,
		},
	},
	optimizeDeps: {
		rolldownOptions: {
			resolve: {
				alias: optimizeAliases,
			},
			transform: {
				target: commonEsbuild.target,
				decorator: {
					legacy: commonEsbuild.tsconfigRaw.compilerOptions.experimentalDecorators,
				},
			},
		},
		...commonOptimizeDeps,
	},
}

export default defineConfig(browserViteConfig)
