import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { pounceBarrelPlugin, pounceCorePlugin } from "@pounce/core/plugin";
import { commonEsbuild, commonOptimizeDeps } from "engine-pixi/vite-config";
import { servePixiAssets } from "engine-pixi/vite-plugins";
import { type Alias, defineConfig, type Plugin } from "vite";
import { pureGlyfPlugin } from "../../../ownk/pounce/packages/pure-glyf/dist/plugin.js";
import { cssTagPlugin } from "../../engines/ssh/vite-plugin-css-tag";

const projectRootDir = dirname(fileURLToPath(import.meta.url));

function stripDeclare(): Plugin {
	// Ambient declaration keywords that must NOT be stripped
	const ambientKeywords =
		/^(module|namespace|class|function|var|let|const|enum|abstract|interface|type|global)\b/;

	return {
		name: "strip-declare",
		enforce: "pre",
		transform(code, id) {
			if (!/\.[cm]?tsx?$/.test(id)) return null;
			if (id.includes("node_modules")) return null;
			if (!code.includes("declare ")) return null;

			// Only strip declare from ssh engine files.
			// The npcs parser files use 'declare block:' to prevent class field
			// initializers from overriding the parent constructor — these are handled
			// correctly by babelPluginTs allowDeclareFields:true and must NOT be stripped.
			// The ssh engine files have decorated classes where the Babel decorators
			// plugin (running before babelPluginTs) rejects 'declare' fields outright.
			if (!id.includes("/engines/ssh/")) return null;

			const result = code.replace(
				/\bdeclare\s+(?=[a-zA-Z_$[])/g,
				(match, offset) => {
					const after = code.slice(offset + match.length);
					if (ambientKeywords.test(after)) return match;
					return "";
				},
			);

			return result !== code ? result : null;
		},
	};
}

const aliases: Alias[] = [
	{
		find: /^pure-glyf$/,
		replacement: resolvePath(
			projectRootDir,
			"../../../ownk/pounce/packages/pure-glyf/src/index.ts",
		),
	},
	{
		find: /^pure-glyf\/pounce$/,
		replacement: resolvePath(
			projectRootDir,
			"../../../ownk/pounce/packages/pure-glyf/src/pounce.tsx",
		),
	},
	{ find: "@app", replacement: resolvePath(projectRootDir, "src") },
	{ find: "$lib", replacement: resolvePath(projectRootDir, "src/lib") },
	{ find: "$assets", replacement: resolvePath(projectRootDir, "assets") },
	{
		find: "ssh/assets",
		replacement: resolvePath(projectRootDir, "../../engines/ssh/assets"),
	},
	{
		find: "ssh",
		replacement: resolvePath(projectRootDir, "../../engines/ssh/src/lib"),
	},
	{
		find: "engine-pixi/assets",
		replacement: resolvePath(projectRootDir, "../../engines/pixi/assets"),
	},
	{
		find: "engine-pixi",
		replacement: resolvePath(projectRootDir, "../../engines/pixi/src"),
	},
	{
		find: "mutts",
		replacement: resolvePath(projectRootDir, "../../../ownk/mutts/src"),
	},
	{
		find: "@picocss/pico",
		replacement: resolvePath(projectRootDir, "node_modules/@picocss/pico"),
	},
	{
		find: "dockview-core",
		replacement: resolvePath(projectRootDir, "node_modules/dockview-core"),
	},
];

const optimizeAliases = {
	"@app": resolvePath(projectRootDir, "src"),
	$lib: resolvePath(projectRootDir, "src/lib"),
	$assets: resolvePath(projectRootDir, "assets"),
	"ssh/assets": resolvePath(projectRootDir, "../../engines/ssh/assets"),
	ssh: resolvePath(projectRootDir, "../../engines/ssh/src/lib"),
	"engine-pixi/assets": resolvePath(
		projectRootDir,
		"../../engines/pixi/assets",
	),
	"engine-pixi": resolvePath(projectRootDir, "../../engines/pixi/src"),
	mutts: resolvePath(projectRootDir, "../../../ownk/mutts/src"),
	"@picocss/pico": resolvePath(projectRootDir, "node_modules/@picocss/pico"),
	"dockview-core": resolvePath(projectRootDir, "node_modules/dockview-core"),
	"pure-glyf": resolvePath(
		projectRootDir,
		"../../../ownk/pounce/packages/pure-glyf/src/index.ts",
	),
	"pure-glyf/pounce": resolvePath(
		projectRootDir,
		"../../../ownk/pounce/packages/pure-glyf/src/pounce.tsx",
	),
};

export default defineConfig({
	plugins: [
		stripDeclare(), // Must run first, before Babel
		pureGlyfPlugin({
			icons: {
				mdi: "node_modules/@mdi/svg/svg",
				tabler: "node_modules/@tabler/icons/icons",
			},
			dts: "src/pure-glyf-icons.d.ts",
		}) as any,
		cssTagPlugin(),
		servePixiAssets(),
		pounceCorePlugin({
			projectRoot: projectRootDir,
			onlyRemoveTypeImports: true,
		}),
		pounceBarrelPlugin({
			name: "@pounce",
			skeleton: "front-end",
			adapter: "@pounce/adapter-pico",
			dts: "src/@pounce.d.ts",
		}),
	],
	resolve: {
		alias: aliases,
		preserveSymlinks: false,
	},
	server: {
		fs: {
			allow: ["..", "../../.."],
		},
		watch: {
			usePolling: true,
			interval: 1000,
			ignored: [
				"**/node_modules/**",
				"**/.git/**",
				"**/dist/**",
				"**/coverage/**",
			],
		},
	},
	esbuild: {
		...commonEsbuild,
		target: "node14",
	},
	optimizeDeps: {
		esbuildOptions: {
			...commonEsbuild,
			alias: optimizeAliases,
		},
		...commonOptimizeDeps,
	},
});
