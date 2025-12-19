import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Only use base path for production builds (GitHub Pages)
  base: command === 'build' ? '/ym2149-wa/' : '/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
  server: {
    port: 3000,
    open: true,
    // Enable SharedArrayBuffer for real-time audio visualization
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Preview server also needs these headers
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
