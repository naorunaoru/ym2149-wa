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
  },
}));
