import type { Plugin } from 'vite'
import { debugObjectId } from 'ssh/dev/debug-object-id'

/**
 * Vite plugin to serve and copy Pixi assets.
 */
export function servePixiAssets(): Plugin
