import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'tactic-engine', environment: 'node', include: ['test/**/*.test.ts'] },
});
