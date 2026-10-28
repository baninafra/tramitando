import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Respuesta de error con la forma acordada: { error: { codigo, mensaje } }. */
export function error(c: Context, status: ContentfulStatusCode, codigo: string, mensaje: string) {
  return c.json({ error: { codigo, mensaje } }, status);
}
