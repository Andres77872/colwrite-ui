import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rawKatexCssPlugin } from './vite.raw-katex';

export default defineConfig({
  plugins: [rawKatexCssPlugin(), react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  build: {
    target: 'node20',
    outDir: 'dist-renderer',
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    ssr: new URL('./src/export/renderStandaloneHtml.tsx', import.meta.url).pathname,
    rolldownOptions: {
      output: {
        entryFileNames: 'document-renderer.js',
        codeSplitting: false,
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
