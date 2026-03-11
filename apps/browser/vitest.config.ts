import { mergeConfig } from "vite";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig as any, {
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./test-setup.ts"],
		include: ["src/**/*.{test,spec}.{js,ts,tsx}"],
		exclude: ["node_modules", "dist", ".git", ".cache"],
		watch: false,
	},
	resolve: {
		conditions: ["browser", "development", "import", "default"],
	},
});
