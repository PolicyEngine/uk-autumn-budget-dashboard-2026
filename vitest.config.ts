import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    pool: "threads",
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 30000,
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    server: {
      deps: {
        // Inline @policyengine/ui-kit so jsdom can resolve its ESM exports.
        inline: ['@policyengine/ui-kit'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
