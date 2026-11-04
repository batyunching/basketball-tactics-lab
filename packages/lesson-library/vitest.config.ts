import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'lesson-library', environment: 'node', include: ['test/**/*.test.ts'] },
});
