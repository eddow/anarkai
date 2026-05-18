import { resolve as resolvePath } from "node:path";

/**
 * Get common path aliases for Vite config.
 * @param {string} projectRootDir - The root directory of the project
 * @returns {Record<string, string>}
 */
export function getCommonAliases(projectRootDir) {
	return {
		"@ssh": resolvePath(projectRootDir, "../../engines/ssh/src"),
		"engine-pixi": resolvePath(projectRootDir, "../../engines/pixi/src"),
		ssh: resolvePath(projectRootDir, "../../engines/ssh/src"),
		$lib: resolvePath(projectRootDir, "../../engines/ssh/src/lib"),
		$assets: resolvePath(projectRootDir, "../../engines/ssh/assets"),
	};
}

/** @type {{ exclude: string[], include: string[] }} */
export const commonOptimizeDeps = {
	exclude: [
		"@sursaut/core",
		"@sursaut/core/dom",
		"@sursaut/kit",
		"@sursaut/kit/dom",
		"@sursaut/ui",
		"ssh",
		"engine-pixi",
		"mutts",
		"npc-script",
		"omni18n",
		"pixi.js",
		"pure-glyf/sursaut",
		"sursaut-ts",
		"sursaut-ui",
	],
	include: [
		"arktype",
		"@xmldom/xmldom",
		"eventemitter3",
		"parse-svg-path",
	],
};

/** @type {{ target: string, tsconfigRaw: { compilerOptions: { experimentalDecorators: boolean } } }} */
export const commonEsbuild = {
	target: "es2022",
	tsconfigRaw: {
		compilerOptions: {
			experimentalDecorators: true,
		},
	},
};
