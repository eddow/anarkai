import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, {
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
});
