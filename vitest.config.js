import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://github.com/' } },
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['content.js'],
      reporter: ['text'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
