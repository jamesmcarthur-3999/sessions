import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'vendor/',
      ],
    },
    // Worker tests need special handling
    pool: 'forks',
    // Timeout for async operations
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@baleybots/core': path.resolve(__dirname, './vendor/baleybots/typescript/packages/core/src'),
      'is-wsl': path.resolve(__dirname, './src/shims/is-wsl.ts'),
      'wsl-utils': path.resolve(__dirname, './src/shims/wsl-utils.ts'),
      'open': path.resolve(__dirname, './src/shims/open.ts'),
      '@baleybots/auth': path.resolve(__dirname, './src/shims/baleybots-auth.ts'),
    },
  },
});
