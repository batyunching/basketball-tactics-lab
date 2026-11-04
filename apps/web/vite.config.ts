/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 以子路徑（/<repo>/）提供網站。使用相對路徑 './'，
// 不論 repo 名稱為何都能正確載入；也可用 VITE_BASE 覆寫。
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
