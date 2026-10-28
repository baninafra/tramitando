/**
 * API de Tramitando. Especificación: docs/arquitectura.md.
 *
 * Cada grupo de rutas vive en su archivo de `rutas/` y se monta acá. Los crons están en `cron/`.
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { error } from './util/errores';
import { publica } from './rutas/publica';
import { reportes } from './rutas/reportes';
import { ingest } from './rutas/ingest';
import { admin } from './rutas/admin';
import { tareasProgramadas } from './cron';

const app = new Hono<{ Bindings: Env }>();

app.route('/v1', publica);
app.route('/v1/reportes', reportes);
app.route('/ingest/v1', ingest);
app.route('/admin/v1', admin);

app.notFound((c) => error(c, 404, 'no_encontrado', 'No encontramos lo que buscás.'));
app.onError((err, c) => {
  console.error(err);
  return error(c, 500, 'error_interno', 'Algo salió mal de nuestro lado. Probá de nuevo en un rato.');
});

export default {
  fetch: app.fetch,
  scheduled: tareasProgramadas,
} satisfies ExportedHandler<Env>;

export { app };
