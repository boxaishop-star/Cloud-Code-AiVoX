import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from monorepo root (two levels up from apps/api/)
const appRoot = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(appRoot, '../../.env') });

export default defineConfig({
  resolve: {
    alias: {
      '@aivox/core': resolve(appRoot, '../../packages/core/src/index.ts'),
    },
  },
});
