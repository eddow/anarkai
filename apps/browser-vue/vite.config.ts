import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { cssTagPlugin } from './vite-plugin-css-tag'
import { execSync } from 'node:child_process';



const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({

  plugins: [
    vue(),
    cssTagPlugin(),
    {
        name: 'serve-pixi-assets',
        configureServer(server) {
            server.middlewares.use('/pixi-assets', (req, res, next) => {
                const url = req.url?.split('?')[0] || '';
                const targetPath = path.resolve(__dirname, '../../engines/pixi/assets', '.' + url);
                
                if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
                    const ext = path.extname(targetPath).toLowerCase();
                    const mimeTypes: Record<string, string> = {
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
             const src = path.resolve(__dirname, '../../engines/pixi/assets');
             const dest = path.resolve(__dirname, 'dist/pixi-assets');
             if (!fs.existsSync(dest)) {
                 fs.mkdirSync(dest, { recursive: true });
             }
             // execSync imported at top level
             try {
                execSync(`cp -r "${src}/." "${dest}/"`);
             } catch (e) {
                console.warn('Failed to copy pixi assets', e);
             }
        }
    }
  ],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler'
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ssh': path.resolve(__dirname, '../../engines/ssh/src'),
      'engine-pixi': path.resolve(__dirname, '../../engines/pixi'),
      'ssh': path.resolve(__dirname, '../../engines/ssh'),
      '$lib': path.resolve(__dirname, '../../engines/ssh/src/lib'),
      '$assets': path.resolve(__dirname, '../../engines/ssh/assets'),
      '@app': path.resolve(__dirname, '../../engines/ssh/src'),
      'mutts': path.resolve(__dirname, './src/mutts-shim.ts'), 
      'npc-script': path.resolve(__dirname, '../../packages/npcs'),
    },
    preserveSymlinks: false 
    // Actually, if we point to real paths, preserveSymlinks matters less for these aliases.
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: ['..', '../../..'], 
    },
    watch: {
        usePolling: true,
        interval: 1000,
        ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'],
    },
  },
  // Serve engines/pixi/assets as /assets/pixi
  publicDir: "public",
  esbuild: {
    target: "es2022",
    tsconfigRaw: {
        compilerOptions: {
            experimentalDecorators: true
        }
    }
  },
  optimizeDeps: {
      esbuildOptions: {
          target: "es2022",
          tsconfigRaw: {
              compilerOptions: {
                  experimentalDecorators: true
              }
          },
          alias: {
              '@ssh': path.resolve(__dirname, '../../engines/ssh/src'),
              '$lib': path.resolve(__dirname, '../../engines/ssh/src/lib'),
              '$assets': path.resolve(__dirname, '../../engines/ssh/assets'),
              '@app': path.resolve(__dirname, '../../engines/ssh/src'),
          }
      },
      exclude: ['ssh', 'engine-pixi', 'mutts', 'npc-script', 'omni18n', 'pounce-ts', 'pounce-ui'],
      include: [
        'pixi.js',
        'arktype',
        '@ark/schema',
        '@ark/util',
        'earcut',
        'tiny-lru',
        '@pixi/colord',
        '@pixi/colord/plugins/names',
        'parse-svg-path',
        'ismobilejs',
        '@xmldom/xmldom',
        'eventemitter3'
      ]
  }
})
