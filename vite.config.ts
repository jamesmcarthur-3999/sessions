import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Tauri expects a fixed port
  server: {
    port: 5173,
    strictPort: true,
  },
  // Prevent Vite from clearing the terminal
  clearScreen: false,
  // Externalize baleybots packages (they use Node.js APIs and only run in Tauri)
  build: {
    rollupOptions: {
      external: [
        '@baleybots/core',
        '@baleybots/auth',
        'wsl-utils',
        'open',
        'is-wsl',
      ],
    },
  },
  // Optimize deps to exclude Node.js packages
  optimizeDeps: {
    exclude: ['@baleybots/core', '@baleybots/auth'],
  },
})
