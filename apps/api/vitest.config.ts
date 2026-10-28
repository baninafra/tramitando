import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migraciones = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migraciones,
            TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
            INGEST_TOKEN: 'token-de-prueba',
            IP_SALT: 'sal-de-prueba',
            ADMIN_DEV: '1',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/aplicar-migraciones.ts'] },
  };
});
