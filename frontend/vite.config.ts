import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  // Mirrors tsconfig.json's "@/*" path mapping — that entry only satisfies
  // TypeScript's own type-checker (tsc), which is the first half of `npm
  // run build`. Without this, the type-check would pass locally but the
  // actual bundler (the second half, `vite build`) would have no way to
  // resolve @/ imports at all, failing the real build in CI even though
  // everything looked correct up to that point.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
