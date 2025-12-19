import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Only use base path for production builds (GitHub Pages)
  base: command === 'build' ? '/ym2149-wa/' : '/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
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
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
