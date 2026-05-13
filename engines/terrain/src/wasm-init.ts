/**
 * Synchronous WASM initialization module.
 * Import this at the top level to ensure WASM is loaded before use.
 */

// Import WASM module synchronously - this blocks until loaded
import * as wasmModule from 'anarkai-core'

// Export the loaded module for use by other modules
export const wasm = wasmModule

// Export availability flag
export const isWasmAvailable = true
