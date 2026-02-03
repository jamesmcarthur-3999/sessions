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
      // Baleybots packages are Node.js-only - provide browser shims
      '@baleybots/auth': path.resolve(__dirname, './src/shims/baleybots-auth.ts'),
      '@baleybots/core': path.resolve(__dirname, './src/shims/baleybots-core.ts'),
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
  // Optimize deps configuration
  optimizeDeps: {
    // Don't pre-bundle these Node.js-only packages
    exclude: ['@baleybots/core', '@baleybots/auth', 'is-wsl', 'wsl-utils', 'open'],
  },
  // SSR configuration for Node.js modules
  ssr: {
    // These packages should not be externalized - they need to be bundled
    noExternal: [],
    // These are Node.js-only and should be externalized
    external: ['@baleybots/core', '@baleybots/auth', 'is-wsl', 'wsl-utils', 'open'],
  },
})
