export interface Env {
  DB: D1Database;
  /** Capturas que suben los usuarios como prueba de un reporte. */
  PRUEBAS: R2Bucket;
  TURNSTILE_SECRET: string;
  /** Token de la investigación para /ingest/v1. */
  INGEST_TOKEN: string;
  /** Sal para el hash de IP de los reportes. */
  IP_SALT: string;
  /** Cloudflare Access: audiencia de la aplicación del dashboard. */
  ACCESS_AUD: string;
  /** Cloudflare Access: nombre del team (<team>.cloudflareaccess.com). */
  ACCESS_TEAM: string;
  /** "1" solo en desarrollo local: saltea la validación de Access. */
  ADMIN_DEV?: string;
}
