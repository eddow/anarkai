import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Vite plugin to serve and copy Pixi assets.
 * @returns {import('vite').Plugin}
 */
export function servePixiAssets() {
	return {
		name: 'serve-pixi-assets',
		configureServer(server) {
			server.middlewares.use('/pixi-assets', (req, res, next) => {
				const url = req.url?.split('?')[0] || '';
				const targetPath = path.resolve(__dirname, 'assets', '.' + url);

				if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
					const ext = path.extname(targetPath).toLowerCase();
					/** @type {Record<string, string>} */
					const mimeTypes = {
						'.png': 'image/png',
						'.jpg': 'image/jpeg',
						'.jpeg': 'image/jpeg',
						'.json': 'application/json',
						'.atlas': 'text/plain',
						'.txt': 'text/plain'
					};
					const mime = mimeTypes[ext] || 'application/octet-stream';
					res.setHeader('Content-Type', mime);
					fs.createReadStream(targetPath).pipe(res);
				} else {
					next();
				}
			});
		},
		closeBundle() {
			const src = path.resolve(__dirname, 'assets');
			const dest = path.resolve(process.cwd(), 'dist/pixi-assets');
			if (!fs.existsSync(dest)) {
				fs.mkdirSync(dest, { recursive: true });
			}
			try {
				execSync(`cp -r "${src}/." "${dest}/"`);
			} catch (e) {
				console.warn('Failed to copy pixi assets', e);
			}
		}
	}
}
