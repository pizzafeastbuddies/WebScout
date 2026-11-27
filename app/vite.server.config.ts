import { defineConfig } from 'vite';

// Bundles app/engine-server.ts and the engine into one Node ESM file. Uses the
// vite already in devDependencies, so no new package is needed.
//   npm run build:server  ->  dist-server/engine-server.mjs
export default defineConfig({
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'app/engine-server.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'engine-server.mjs', format: 'es' } },
  },
});
