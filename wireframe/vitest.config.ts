import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    testNamePattern:
      /(?:creates, selects and edits a block from the inspector|edits geometry, duplicates and deletes the selected block|creates a child, shows its parent relationship, reparents it and saves the expanded canvas|imports a valid JSON document and keeps the current one after an error|rejects invalid parents, self references, and nested grandchildren|saves and restores a validated document|rejects oversized, malformed and schema-invalid files|round-trips a v2 document with explicit parent references)$/,
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
