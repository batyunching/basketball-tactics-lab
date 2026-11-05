import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'video-engine', environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
