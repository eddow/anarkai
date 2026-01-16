import { resolve as resolvePath } from 'node:path'

/**
 * Get common path aliases for Vite config.
 * @param {string} projectRootDir - The root directory of the project
 * @returns {Record<string, string>}
 */
export function getCommonAliases(projectRootDir) {
	return {
		'@ssh': resolvePath(projectRootDir, '../../engines/ssh/src'),
		'engine-pixi': resolvePath(projectRootDir, '../../engines/pixi'),
		'ssh': resolvePath(projectRootDir, '../../engines/ssh'),
		'$lib': resolvePath(projectRootDir, '../../engines/ssh/src/lib'),
		'$assets': resolvePath(projectRootDir, '../../engines/ssh/assets'),
	}
}

/** @type {{ exclude: string[], include: string[] }} */
export const commonOptimizeDeps = {
	exclude: ['ssh', 'engine-pixi', 'mutts', 'npc-script', 'omni18n', 'pounce-ts', 'pounce-ui'],
	include: [
		'pixi.js',
		'arktype',
		'@ark/schema',
		'@ark/util',
		'earcut',
		'tiny-lru',
		'@pixi/colord',
		'@pixi/colord/plugins/names',
		'parse-svg-path',
		'ismobilejs',
		'@xmldom/xmldom',
		'eventemitter3'
	]
}

/** @type {{ target: string, tsconfigRaw: { compilerOptions: { experimentalDecorators: boolean } } }} */
export const commonEsbuild = {
	target: 'es2022',
	tsconfigRaw: {
		compilerOptions: {
			experimentalDecorators: true,
		},
	},
}
