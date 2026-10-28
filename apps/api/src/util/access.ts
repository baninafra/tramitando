/**
 * Middleware de Cloudflare Access para `/admin/v1`.
 *
 * En local (`ADMIN_DEV === '1'`) se saltea la validación. En producción se verifica el JWT que
 * Access agrega en `Cf-Access-Jwt-Assertion` contra el JWKS del team y la audiencia configurada.
 */
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../env';
import { error } from './errores';

const MENSAJE = 'Necesitás iniciar sesión en el dashboard.';

export const requiereAccess = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.env.ADMIN_DEV === '1') return next();

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return error(c, 401, 'no_autorizado', MENSAJE);

  try {
    const team = c.env.ACCESS_TEAM;
    if (!team || !c.env.ACCESS_AUD) return error(c, 401, 'no_autorizado', MENSAJE);

    const issuer = `https://${team}.cloudflareaccess.com`;
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    await jwtVerify(token, jwks, { audience: c.env.ACCESS_AUD, issuer });
  } catch {
    return error(c, 401, 'no_autorizado', MENSAJE);
  }

  return next();
});
