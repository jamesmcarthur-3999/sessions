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
      // Provide browser shims for Node.js-only packages
      'is-wsl': path.resolve(__dirname, './src/shims/is-wsl.ts'),
      'wsl-utils': path.resolve(__dirname, './src/shims/wsl-utils.ts'),
      'open': path.resolve(__dirname, './src/shims/open.ts'),
      '@baleybots/auth': path.resolve(__dirname, './src/shims/baleybots-auth.ts'),
    },
  },
  // Tauri expects a fixed port
  server: {
    port: 5173,
    strictPort: true,
  },
  // Prevent Vite from clearing the terminal
  clearScreen: false,
  // Optimize deps configuration
  optimizeDeps: {
    // These are shimmed to browser-safe versions
    exclude: [],
  },
  // Worker configuration for AI worker
  worker: {
    format: 'es',
    plugins: () => [react()],
    rollupOptions: {
      output: {
        // Ensure workers get proper chunk names
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
})
