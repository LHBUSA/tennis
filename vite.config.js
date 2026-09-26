import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
    assetsInlineLimit: 0
  },
  server: { port: 5194, strictPort: true },
  preview: { port: 5194, strictPort: true }
});
