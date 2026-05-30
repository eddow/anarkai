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
			deps: {
				optimizer: {
					ssr: {
						include: ['mutts'],
					},
				},
			},
		},
		resolve: {
			conditions: ["browser", "development", "import", "default"],
		},
	}),
);
