import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Vite plugin to serve and copy engine-rules assets (icons, roads, …) so any
 * app (browser, atlas, future engines) can reach them independent of pixi.
 * @returns {import('vite').Plugin}
 */
export function serveRulesAssets() {
	return {
		name: "serve-rules-assets",
		configureServer(server) {
			server.middlewares.use("/rules-assets", (req, res, next) => {
				const url = req.url?.split("?")[0] || "";
				const targetPath = path.resolve(__dirname, "assets", "." + url);

				if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
					const ext = path.extname(targetPath).toLowerCase();
					/** @type {Record<string, string>} */
					const mimeTypes = {
						".png": "image/png",
						".jpg": "image/jpeg",
						".jpeg": "image/jpeg",
						".json": "application/json",
						".svg": "image/svg+xml",
						".atlas": "text/plain",
						".txt": "text/plain",
					};
					const mime = mimeTypes[ext] || "application/octet-stream";
					res.setHeader("Content-Type", mime);
					fs.createReadStream(targetPath).pipe(res);
				} else {
					next();
				}
			});
		},
		closeBundle() {
			const src = path.resolve(__dirname, "assets");
			const dest = path.resolve(process.cwd(), "dist/rules-assets");
			if (!fs.existsSync(src)) return;
			if (!fs.existsSync(dest)) {
				fs.mkdirSync(dest, { recursive: true });
			}
			try {
				fs.cpSync(src, dest, { recursive: true, force: true });
			} catch (e) {
				console.warn("Failed to copy rules assets", e);
			}
		},
	};
}
