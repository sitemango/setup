import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The app writes JSX in .js files (the Next.js convention used throughout
  // app/ and components/). Teach the test transform the same thing, scoped to
  // components and the pages that carry guards worth rendering — the
  // onboarding page, public first-visit guide and timetable selector — so rendering/redirect
  // tests can import them; pure lib modules keep the plain JS loader.
  oxc: {
    lang: 'jsx',
    jsx: { runtime: 'automatic' },
    include: /(?:components\/.*|app\/(?:page|(?:onboarding|guide|timetable(?:\/\[division\])?|\(shell\)\/\(public\)\/.*|\(shell\)\/\(app\)\/explore)\/page)|app\/api\/public\/.*\/route)\.js$/,
    exclude: [],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs}'],
    globals: false,
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
      // `server-only` intentionally throws outside a React Server environment.
      // Unit tests exercise server-side logic in plain Node, so alias it away.
      'server-only': path.resolve(process.cwd(), 'tests/helpers/server-only-stub.js'),
    },
  },
});
