import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../public/js',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        display: resolve(__dirname, 'client/display.ts'),
        play: resolve(__dirname, 'client/play.ts'),
        host: resolve(__dirname, 'client/host.ts'),
        'host-login': resolve(__dirname, 'client/host-login.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
});
