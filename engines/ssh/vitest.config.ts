import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		setupFiles: ["./test-setup.ts"],
		include: ["src/**/*.{test,spec}.{js,ts}", "tests/**/*.{test,spec}.{js,ts}"],
		exclude: ["node_modules", "dist", ".git", ".cache", "tests/e2e"],
		watch: false,
		// Hard ceiling per test so a stuck loop cannot run indefinitely (integration tests can override down).
		testTimeout: 120000,
		hookTimeout: 60000,
		teardownTimeout: 60000,
		silent: true,
		pool: "threads",
		poolOptions: {
			threads: {
				singleThread: true,
			},
		},
	},
	esbuild: {
		target: "node14",
	},
	resolve: {
		alias: [
			{ find: /^engine-terrain\/hex$/, replacement: resolvePath(projectRootDir, "../terrain/src/hex/index.ts") },
			{ find: /^engine-terrain$/, replacement: resolvePath(projectRootDir, "../terrain/src/index.ts") },
			{
				find: /^ssh\/(.*)$/,
				replacement: `${resolvePath(projectRootDir, "src/lib")}/$1`,
			},
			{ find: /^ssh$/, replacement: resolvePath(projectRootDir, "src/lib") },
			{ find: /^npc-script$/, replacement: resolvePath(projectRootDir, "../../../ownk/npcs/src") },
			{ find: /^mutts$/, replacement: resolvePath(projectRootDir, "../../../ownk/mutts/src") },
		],
	},
});
