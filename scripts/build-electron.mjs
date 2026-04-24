import { build } from 'vite'

const isWatch = process.argv.includes('--watch')

const external = (id) => id === 'electron' || id === '@homebridge/node-pty-prebuilt-multiarch' || id.startsWith('node:')

function createConfig(entry, fileName, emptyOutDir) {
  return {
    configFile: false,
    build: {
      outDir: 'dist-electron',
      emptyOutDir,
      minify: false,
      sourcemap: true,
      target: 'node20',
      ...(isWatch ? { watch: {} } : {}),
      lib: {
        entry,
        formats: ['cjs'],
        fileName: () => `${fileName}.cjs`,
      },
      rollupOptions: {
        external,
      },
    },
  }
}

await build(createConfig('electron/main.ts', 'main', !isWatch))
await build(createConfig('electron/preload.ts', 'preload', false))
await build(createConfig('electron/terminalDaemon.ts', 'terminal-daemon', false))
