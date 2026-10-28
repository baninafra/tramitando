/// <reference types="astro/client" />

interface FetcherApi {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module 'cloudflare:workers' {
  export const env: { API?: FetcherApi };
}

interface ImportMetaEnv {
  /** URL de la API en desarrollo (por defecto http://localhost:8787). */
  readonly API_URL?: string;
  /** "1" muestra los datos de ejemplo de `lib/datos-ejemplo.ts` en vez de llamar a la API. */
  readonly DATOS_EJEMPLO?: string;
  /** Site key pública de Cloudflare Turnstile. */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
