import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    target: 'node20',
    lib: {
      entry: {
        main: 'electron/main.ts',
        preload: 'electron/preload.ts',
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: (id) => id === 'electron' || id === 'node-pty' || id.startsWith('node:'),
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
})
