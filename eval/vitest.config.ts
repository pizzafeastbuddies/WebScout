import { defineConfig } from 'vitest/config';

// Standalone config: the app's vite.config.ts pulls in React and Tailwind plugins
// the benchmark does not need. `npm run eval` runs the live benchmark.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts', 'eval/**/*.test.ts'],
  },
});
