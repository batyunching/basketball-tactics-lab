import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'data-schemas', environment: 'node', include: ['test/**/*.test.ts'] },
});
