import type { Plugin } from 'vite'

/**
 * Vite plugin to serve and copy engine-rules assets (icons, roads, …) so any
 * app (browser, atlas, future engines) can reach them independent of pixi.
 */
export function serveRulesAssets(): Plugin
