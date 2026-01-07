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
      '@ssh': path.resolve(__dirname, './node_modules/ssh/src'),
      'ssh': path.resolve(__dirname, './node_modules/ssh/src'), // Force package import to use src
      '$lib': path.resolve(__dirname, './node_modules/ssh/src/lib'),
      '$assets': path.resolve(__dirname, './node_modules/ssh/assets'),
      '@app': path.resolve(__dirname, './node_modules/ssh/src'),
      'mutts': path.resolve(__dirname, './src/mutts-shim.ts'), // Force everything to use shim
      'npc-script': path.resolve(__dirname, './node_modules/npc-script'),
      'npc-script/': path.resolve(__dirname, './node_modules/npc-script/'),
    },
    preserveSymlinks: false 
    // Default is false: Vite follows symlinks. Which means it sees the real path.
    // Use true to keep the symlink path.
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: ['..', '../../..'], // Allow serving files from monorepo root
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
              '@ssh': path.resolve(__dirname, './node_modules/ssh/src'),
              '$lib': path.resolve(__dirname, './node_modules/ssh/src/lib'),
              '$assets': path.resolve(__dirname, './node_modules/ssh/assets'),
              '@app': path.resolve(__dirname, './node_modules/ssh/src'),
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
