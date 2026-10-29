import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  preview: {
    // Production keeps the large SMR datasets at the repository root while
    // promoting the verified app and its smaller auxiliary datasets.
    proxy: {
      '/data/selected-cause-rebuild-v1/': 'http://127.0.0.1:4174',
      '/data/juki-': 'http://127.0.0.1:4174',
      '/data/census-': 'http://127.0.0.1:4174',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
  },
});

