import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import spritesmith from 'spritesmith';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');
const TEMP_DIR = path.join(PROJECT_ROOT, 'temp_sprites');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public', 'pixi-assets');
const UNIFIED_SHEET_NAME = 'unified-spritesheet';

async function extractSpritesFromSheet(jsonPath: string, imagePath: string, outputDir: string, category: string) {
	const jsonContent = await fs.readFile(jsonPath, 'utf8');
	const sheetData = JSON.parse(jsonContent);
	const image = sharp(imagePath);

	for (const [frameName, frameData] of Object.entries(sheetData.frames) as any) {
		const { frame } = frameData;
		const extracted = image.clone().extract({
			left: frame.x,
			top: frame.y,
			width: frame.w,
			height: frame.h,
		});
		
		const targetDir = path.join(outputDir, category);
		await fs.mkdir(targetDir, { recursive: true });
		// Remove .png from frameName if present to avoid .png.png
		const cleanName = frameName.replace(/\.png$/, '');
		await extracted.toFile(path.join(targetDir, `${cleanName}.png`));
	}
}

async function collectStandaloneSprites(sourceDir: string, outputDir: string, category: string) {
	const files = await fs.readdir(sourceDir);
	for (const file of files) {
		if (file.endsWith('.png') && !file.endsWith('.json')) {
			// Check if there is a corresponding JSON (meaning it's a spritesheet to ignore here)
			const hasJson = files.includes(file.replace('.png', '.json'));
			if (!hasJson) {
				const targetDir = path.join(outputDir, category);
				await fs.mkdir(targetDir, { recursive: true });
				const sourcePath = path.join(sourceDir, file);
				const targetPath = path.join(targetDir, file);
				// Make sure we convert it to actual png since some have wrong extension
				await sharp(sourcePath).png().toFile(targetPath);
			}
		}
	}
}

async function main() {
	console.log('Cleaning temp directory...');
	await fs.rm(TEMP_DIR, { recursive: true, force: true });
	await fs.mkdir(TEMP_DIR, { recursive: true });

	// 1. Split existing spritesheets
	const sheetsToSplit = [
		{ category: 'objects.bushes', json: 'objects/bushes.json', img: 'objects/bushes.png' },
		{ category: 'objects.rocks', json: 'objects/rocks.json', img: 'objects/rocks.png' },
		{ category: 'objects.trees', json: 'objects/trees.json', img: 'objects/trees.png' },
	];

	for (const sheet of sheetsToSplit) {
		console.log(`Extracting ${sheet.category}...`);
		const jsonPath = path.join(ASSETS_DIR, sheet.json);
		const imgPath = path.join(ASSETS_DIR, sheet.img);
		
		try {
			await fs.access(jsonPath);
			await fs.access(imgPath);
			await extractSpritesFromSheet(jsonPath, imgPath, TEMP_DIR, sheet.category);
		} catch (e) {
			console.warn(`Skipping ${sheet.category}, files not found:`, e);
		}
	}

	// 2. Collect other sprites
	const standaloneCategories = ['buildings', 'characters', 'commands', 'goods', 'vehicles'];
	for (const category of standaloneCategories) {
		console.log(`Collecting standalone sprites for ${category}...`);
		const categoryPath = path.join(ASSETS_DIR, category);
		try {
			await fs.access(categoryPath);
			await collectStandaloneSprites(categoryPath, TEMP_DIR, category);
		} catch (e) {
			console.warn(`Skipping standalone category ${category}, directory not found.`);
		}
	}
	
	// Collect root sprites as well
	console.log('Collecting root standalone sprites...');
	await collectStandaloneSprites(ASSETS_DIR, TEMP_DIR, 'root');

	// 3. Generate Unified Spritesheet
	console.log('Generating unified spritesheet...');
	
	const allSprites: string[] = [];
	async function scanDir(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await scanDir(fullPath);
			} else if (entry.isFile() && entry.name.endsWith('.png')) {
				allSprites.push(fullPath);
			}
		}
	}
	await scanDir(TEMP_DIR);
	
	if (allSprites.length === 0) {
		console.error('No sprites found to pack.');
		return;
	}

	spritesmith.run({ src: allSprites, padding: 2 }, async (err: Error | null, result: any) => {
		if (err) {
			console.error('Spritesmith error:', err);
			return;
		}

		await fs.mkdir(OUTPUT_DIR, { recursive: true });
		
		const imagePath = path.join(OUTPUT_DIR, `${UNIFIED_SHEET_NAME}.png`);
		await fs.writeFile(imagePath, result.image);
		
		// Build JSON metadata compatible with Pixi.js
		const frames: any = {};
		for (const [spritePath, coords] of Object.entries(result.coordinates) as any) {
			// Extract category and name from path
			const relPath = path.relative(TEMP_DIR, spritePath);
			const parts = relPath.split(path.sep);
			const category = parts[0];
			const fileName = parts[1];
			
			// Normalize key based on category
			let key = '';
			if (category === 'root') {
				key = fileName.replace('.png', '');
			} else if (category.startsWith('objects.')) {
				key = `${category}/${fileName.replace('.png', '')}`;
			} else {
				key = `${category}.${fileName.replace('.png', '')}`;
			}
			
			frames[key] = {
				frame: { x: coords.x, y: coords.y, w: coords.width, h: coords.height },
				rotated: false,
				trimmed: false,
				spriteSourceSize: { x: 0, y: 0, w: coords.width, h: coords.height },
				sourceSize: { w: coords.width, h: coords.height }
			};
		}
		
		const sheetJson = {
			frames,
			meta: {
				app: 'spritesmith',
				image: `${UNIFIED_SHEET_NAME}.png`,
				format: 'RGBA8888',
				size: { w: result.properties.width, h: result.properties.height },
				scale: 1
			}
		};
		
		await fs.writeFile(
			path.join(OUTPUT_DIR, `${UNIFIED_SHEET_NAME}.json`),
			JSON.stringify(sheetJson, null, 2)
		);
		
		console.log(`Unified spritesheet generated at ${OUTPUT_DIR}`);
		console.log('Cleaning temp directory...');
		await fs.rm(TEMP_DIR, { recursive: true, force: true });
	});
}

main().catch(console.error);
