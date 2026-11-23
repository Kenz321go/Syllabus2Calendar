import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirror the "@/*" path alias from tsconfig.json so route modules can be imported in tests.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: { environment: 'node' },
});
