import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'
import { cssTagPlugin } from './vite-plugin-css-tag'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    cssTagPlugin()
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
      'ssh': path.resolve(__dirname, '../../engines/ssh/src'),
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
      exclude: ['ssh', 'mutts', 'npc-script', 'omni18n', 'pounce-ts', 'pounce-ui'],
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
