import { resolve as resolvePath } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { browserViteConfig } from "./vite.config";

export default mergeConfig(
	browserViteConfig,
	defineConfig({
		test: {
			environment: "jsdom",
			globals: true,
			setupFiles: ["./test-setup.ts"],
			include: ["src/**/*.{test,spec}.{js,ts,tsx}"],
			exclude: ["node_modules", "dist", ".git", ".cache"],
			watch: false,
		},
		resolve: {
			alias: [
				{
					find: /^@sursaut\/core$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/core/src/node/index.ts"),
				},
				{
					find: /^@sursaut\/kit$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/kit/src/index.ts"),
				},
				{
					find: /^@sursaut\/ui$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/ui/src/index.ts"),
				},
				{
					find: /^@sursaut\/ui\/dockview$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/ui/src/dockview.ts"),
				},
				{
					find: /^@sursaut\/ui\/models$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/ui/src/models/index.ts"),
				},
				{
					find: /^@sursaut\/ui\/palette$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/ui/src/palette/index.ts"),
				},
				{
					find: /^pure-glyf\/sursaut$/,
					replacement: resolvePath(__dirname, "../../../ownk/sursaut/packages/pure-glyf/src/sursaut.tsx"),
				},
			],
			conditions: ["browser", "development", "import", "default"],
		},
	}),
);
