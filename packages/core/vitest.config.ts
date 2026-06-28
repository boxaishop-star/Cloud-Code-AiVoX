import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from monorepo root (two levels up from packages/core/)
const pkgRoot = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(pkgRoot, '../../.env') });

export default defineConfig({});
