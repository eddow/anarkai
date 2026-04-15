import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { sursautCorePlugin } from "@sursaut/core/plugin";
import { commonEsbuild, commonOptimizeDeps } from "engine-pixi/vite-config";
import { servePixiAssets } from "engine-pixi/vite-plugins";
import { type Alias, defineConfig, type Plugin, type PluginOption, type UserConfig } from "vite";
import { pureGlyfPlugin } from "../../../ownk/sursaut/packages/pure-glyf/dist/plugin.js";
import { cssTagPlugin } from "../../engines/ssh/vite-plugin-css-tag.js";

const projectRootDir = dirname(fileURLToPath(import.meta.url));
const pureGlyfEntry = resolvePath(
	projectRootDir,
	"../../../ownk/sursaut/packages/pure-glyf/src/index.ts",
);
const pureGlyfSursautEntry = resolvePath(
	projectRootDir,
	"../../../ownk/sursaut/packages/pure-glyf/src/sursaut.tsx",
);
const sshAssetsDir = resolvePath(projectRootDir, "../../engines/ssh/assets");
const sshSourceDir = resolvePath(projectRootDir, "../../engines/ssh/src/lib");
const pixiAssetsDir = resolvePath(projectRootDir, "../../engines/pixi/assets");
const pixiSourceDir = resolvePath(projectRootDir, "../../engines/pixi/src");
const muttsSourceDir = resolvePath(projectRootDir, "../../../ownk/mutts/src");
const picoCssDir = resolvePath(projectRootDir, "node_modules/@picocss/pico");
const dockviewCoreDir = resolvePath(projectRootDir, "node_modules/dockview-core");
const sursautUiPaletteEntry = resolvePath(
	projectRootDir,
	"../../../ownk/sursaut/packages/ui/src/palette/index.ts",
);
const sursautUiDockviewEntry = resolvePath(
	projectRootDir,
	"../../../ownk/sursaut/packages/ui/src/dockview.ts",
);
const sursautUiModelsEntry = resolvePath(
	projectRootDir,
	"../../../ownk/sursaut/packages/ui/src/models/index.ts",
);
const sursautUiEntry = resolvePath(
	projectRootDir,
	"../../../ownk/sursaut/packages/ui/src/index.ts",
);
const pureGlyfIcons = {
	mdi: resolvePath(projectRootDir, "node_modules/@mdi/svg/svg"),
	tabler: resolvePath(projectRootDir, "node_modules/@tabler/icons/icons"),
} satisfies Record<string, string>;
const sharedAliasPaths = {
	"@app": resolvePath(projectRootDir, "src"),
	$lib: resolvePath(projectRootDir, "src/lib"),
	$assets: resolvePath(projectRootDir, "assets"),
	"ssh/assets": sshAssetsDir,
	ssh: sshSourceDir,
	"engine-pixi/assets": pixiAssetsDir,
	"engine-pixi": pixiSourceDir,
	mutts: muttsSourceDir,
	"@picocss/pico": picoCssDir,
	"dockview-core": dockviewCoreDir,
	// Use sursaut UI source in dev so palette/API changes are not blocked on `pnpm -C …/ui build`.
	"@sursaut/ui/palette": sursautUiPaletteEntry,
	"@sursaut/ui/dockview": sursautUiDockviewEntry,
	"@sursaut/ui/models": sursautUiModelsEntry,
} satisfies Record<string, string>;
const aliases: Alias[] = [
	{ find: /^pure-glyf$/, replacement: pureGlyfEntry },
	{ find: /^pure-glyf\/sursaut$/, replacement: pureGlyfSursautEntry },
	...Object.entries(sharedAliasPaths).map(([find, replacement]) => ({ find, replacement })),
	// String "@sursaut/ui" is a prefix in Vite and would swallow "@sursaut/ui/models", etc.
	{ find: /^@sursaut\/ui$/, replacement: sursautUiEntry },
];
const optimizeAliases = {
	...sharedAliasPaths,
	"pure-glyf": pureGlyfEntry,
	"pure-glyf/sursaut": pureGlyfSursautEntry,
	// Avoid prefix alias "@sursaut/ui" → index.ts breaking "@sursaut/ui/models" (esbuild).
} satisfies Record<string, string>;
const serverWatchIgnored = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"];
const usePollingWatch = process.env.VITE_USE_POLLING === "true";
const serverWatchConfig = usePollingWatch
	? {
			usePolling: true,
			interval: 1000,
			ignored: serverWatchIgnored,
		}
	: {
			ignored: serverWatchIgnored,
		};
// `pure-glyf` is linked from a sibling workspace and carries its own Vite types.
// Adapt it once here so the rest of this config can stay strongly typed.
const pureGlyfPluginOption = pureGlyfPlugin({
	icons: pureGlyfIcons,
	dts: "src/pure-glyf-icons.d.ts",
}) as unknown as PluginOption;

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
	},
	server: {
		port: 5360,
		fs: {
			allow: ["..", "../../.."],
		},
		watch: serverWatchConfig,
	},
	esbuild: {
		...commonEsbuild,
	},
	optimizeDeps: {
		esbuildOptions: {
			...commonEsbuild,
			alias: optimizeAliases,
		},
		...commonOptimizeDeps,
	},
};

export default defineConfig(browserViteConfig);
