import { defineConfig } from 'vite'

// Electron bundles are built via scripts/build-electron.mjs.
// Keeping this file as a valid no-op config avoids accidental multi-entry lib builds
// that can cause preload.cjs to import main.cjs.
export default defineConfig({})
