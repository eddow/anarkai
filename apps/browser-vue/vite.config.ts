import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'
import { servePixiAssets } from 'engine-pixi/vite-plugins'
import { getCommonAliases, commonOptimizeDeps, commonEsbuild } from 'engine-pixi/vite-config'
import { cssTagPlugin } from 'ssh/vite-plugin-css-tag'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    cssTagPlugin(),
    servePixiAssets()
  ],
  css: {
    preprocessorOptions: {
      scss: {
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...getCommonAliases(__dirname),
      '@app': path.resolve(__dirname, '../../engines/ssh/src'),
    },
    preserveSymlinks: false 
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
  publicDir: "public",
  esbuild: commonEsbuild,
  optimizeDeps: {
      esbuildOptions: {
          ...commonEsbuild,
          alias: {
              ...getCommonAliases(__dirname),
              '@app': path.resolve(__dirname, '../../engines/ssh/src'),
          }
      },
      ...commonOptimizeDeps
  }
})
