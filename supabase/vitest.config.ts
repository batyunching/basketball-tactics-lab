import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'rls', environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
