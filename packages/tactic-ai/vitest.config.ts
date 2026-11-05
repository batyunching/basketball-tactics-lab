import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'tactic-ai', environment: 'node', include: ['test/**/*.test.ts'] },
});
