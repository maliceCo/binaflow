import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
