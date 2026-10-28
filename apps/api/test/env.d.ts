import type { Env as EnvApi } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends EnvApi {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}
