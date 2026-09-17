import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

export default defineConfig({
  // A GitHub Pages project site serves from /<repo>/, not the domain root. The
  // Pages workflow sets BASE_PATH; everything else (dev, Codespaces, a local
  // preview, any root-hosted deploy) stays at '/'.
  base: process.env.BASE_PATH ?? '/',
  server: {
    // Codespaces and other remote dev hosts proxy the dev server under their
    // own hostname, which Vite blocks by default.
    host: true,
    allowedHosts: ['.app.github.dev', '.github.dev', 'localhost'],
  },
  preview: {
    host: true,
    allowedHosts: ['.app.github.dev', '.github.dev', 'localhost'],
  },
  plugins: [
    react(),
    // Copies Bravura + the SoundFont into public/ (served in dev, emitted on build)
    // and wires up alphaTab's web worker and audio worklet.
    alphaTab({ assetOutputDir: 'public' }),
  ],
  optimizeDeps: {
    // Essentia's WASM glue is a 2.5MB single-file emscripten bundle; leave it as
    // a lazily fetched chunk rather than pre-bundling it into the dev entry.
    exclude: ['essentia.js'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
});
