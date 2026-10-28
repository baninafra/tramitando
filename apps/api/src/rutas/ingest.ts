/**
 * Ingesta de la investigación (`/ingest/v1`). Todas las rutas exigen un Bearer token.
 *
 * Ver docs/arquitectura.md, sección "Ingesta". Los cambios nunca se publican: terminan en
 * `borradores` y esperan la aprobación del admin.
 */
import { BorradorFicha, EntradaCatalogo } from '@tramitando/shared';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { crearBorrador } from '../borradores/crear';
import type { Env } from '../env';
import { error } from '../util/errores';
import { verificarTokenIngesta } from '../util/ingest-auth';

export const ingest = new Hono<{ Bindings: Env }>();

const MAXIMO_ENTRADAS = 500;
const MAXIMO_TRABAJO = 50;
const TRABAJO_POR_DEFECTO = 10;
const HORAS_TOMA = 6;

type EnvApi = { Bindings: Env };

interface FilaItemTrabajo {
  id: number;
  catalogo_id: number | null;
  variante_id: number | null;
  motivo: string;
  prioridad: number;
  creado_en: string;
}

interface FilaCatalogo {
  id: number;
  url: string;
  nombre_oficial: string;
  jurisdiccion_id: string;
  organismo: string | null;
  temas_sugeridos: string;
  portal: string;
  estado: string;
  prioridad: number;
}

interface FilaVarianteTrabajo {
  id: number;
  tramite_slug: string;
  jurisdiccion_id: string;
  contenido: string;
}

interface FilaCostoTrabajo {
  modalidad: string;
  monto_centavos: number | null;
  gratis: number;
  vigente_desde: string | null;
  nota: string | null;
  fuente_url: string | null;
}

interface FilaFuenteTrabajo {
  url: string;
  titulo: string | null;
  bloque: string;
}

ingest.use('*', async (c, next) => {
  const autorizado = await verificarTokenIngesta(c.req.header('Authorization'), c.env.INGEST_TOKEN);
  if (!autorizado) {
    return error(c, 401, 'no_autorizado', 'Falta el token de ingesta o no es válido.');
  }
  await next();
});

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

async function leerJson(c: Context<EnvApi>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function mensajeZod(errorZod: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return errorZod.issues
    .map((issue) => {
      const ruta = issue.path.map((parte) => String(parte)).join('.');
      return ruta ? `${ruta}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function enteroPositivo(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor;
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const numero = Number(valor.trim());
    if (Number.isSafeInteger(numero) && numero > 0) return numero;
  }
  return null;
}

function parsearJson<T>(texto: string, respaldo: T): T {
  try {
    return JSON.parse(texto) as T;
  } catch {
    return respaldo;
  }
}

function normalizarLimite(valor: string | undefined): number {
  if (!valor) return TRABAJO_POR_DEFECTO;
  const numero = Number.parseInt(valor, 10);
  if (!Number.isFinite(numero) || numero < 1) return TRABAJO_POR_DEFECTO;
  return Math.min(numero, MAXIMO_TRABAJO);
}

async function leerCatalogo(db: D1Database, id: number): Promise<Record<string, unknown> | null> {
  const fila = await db
    .prepare(
      `SELECT id, url, nombre_oficial, jurisdiccion_id, organismo, temas_sugeridos, portal, estado, prioridad
       FROM catalogo WHERE id = ?`,
    )
    .bind(id)
    .first<FilaCatalogo>();
  if (!fila) return null;

  return {
    id: fila.id,
    url: fila.url,
    nombre_oficial: fila.nombre_oficial,
    jurisdiccion_id: fila.jurisdiccion_id,
    organismo: fila.organismo,
    temas_sugeridos: parsearJson<string[]>(fila.temas_sugeridos, []),
    portal: fila.portal,
    estado: fila.estado,
    prioridad: fila.prioridad,
  };
}

async function leerVariante(db: D1Database, id: number): Promise<Record<string, unknown> | null> {
  const fila = await db
    .prepare(
      `SELECT v.id, t.slug AS tramite_slug, v.jurisdiccion_id, v.contenido
       FROM variantes v INNER JOIN tramites t ON t.id = v.tramite_id
       WHERE v.id = ?`,
    )
    .bind(id)
    .first<FilaVarianteTrabajo>();
  if (!fila) return null;

  const [costos, fuentes] = await Promise.all([
    db
      .prepare(
        `SELECT c.modalidad, c.monto_centavos, c.gratis, c.vigente_desde, c.nota, f.url AS fuente_url
         FROM costos c LEFT JOIN fuentes f ON f.id = c.fuente_id
         WHERE c.variante_id = ?
         ORDER BY c.orden, c.id`,
      )
      .bind(id)
      .all<FilaCostoTrabajo>(),
    db
      .prepare(
        `SELECT f.url, f.titulo, vf.bloque
         FROM variante_fuentes vf INNER JOIN fuentes f ON f.id = vf.fuente_id
         WHERE vf.variante_id = ?
         ORDER BY f.id, vf.bloque`,
      )
      .bind(id)
      .all<FilaFuenteTrabajo>(),
  ]);

  const mapaFuentes = new Map<string, { url: string; titulo: string | null; bloques: string[] }>();
  for (const fuente of fuentes.results) {
    const actual = mapaFuentes.get(fuente.url);
    if (actual) {
      if (!actual.bloques.includes(fuente.bloque)) actual.bloques.push(fuente.bloque);
    } else {
      mapaFuentes.set(fuente.url, { url: fuente.url, titulo: fuente.titulo, bloques: [fuente.bloque] });
    }
  }

  return {
    id: fila.id,
    tramite_slug: fila.tramite_slug,
    jurisdiccion_id: fila.jurisdiccion_id,
    contenido: parsearJson<unknown>(fila.contenido, null),
    costos: costos.results.map((costo) => ({
      modalidad: costo.modalidad,
      gratis: costo.gratis === 1,
      monto_centavos: costo.monto_centavos,
      vigente_desde: costo.vigente_desde,
      nota: costo.nota,
      fuente_url: costo.fuente_url,
    })),
    fuentes: [...mapaFuentes.values()],
  };
}

ingest.post('/catalogo', async (c) => {
  const cuerpo = await leerJson(c);
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo.entradas)) {
    return error(c, 400, 'cuerpo_invalido', 'Mandá un objeto con la lista "entradas".');
  }
  if (cuerpo.entradas.length > MAXIMO_ENTRADAS) {
    return error(c, 400, 'demasiadas_entradas', `El máximo es de ${MAXIMO_ENTRADAS} entradas por pedido.`);
  }

  let nuevas = 0;
  let repetidas = 0;
  const invalidas: { indice: number; error: string }[] = [];

  for (let indice = 0; indice < cuerpo.entradas.length; indice += 1) {
    const entrada = EntradaCatalogo.safeParse(cuerpo.entradas[indice]);
    if (!entrada.success) {
      invalidas.push({ indice, error: mensajeZod(entrada.error) });
      continue;
    }

    const prioridad = entrada.data.jurisdiccion_id === 'nacion' ? 10 : 100;

    let insertado: D1Result<unknown>;
    try {
      insertado = await c.env.DB.prepare(
        `INSERT INTO catalogo
           (url, nombre_oficial, jurisdiccion_id, organismo, temas_sugeridos, portal, prioridad)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO NOTHING`,
      )
        .bind(
          entrada.data.url,
          entrada.data.nombre_oficial,
          entrada.data.jurisdiccion_id,
          entrada.data.organismo,
          JSON.stringify(entrada.data.temas_sugeridos),
          entrada.data.portal,
          prioridad,
        )
        .run();
    } catch (falla) {
      const mensaje = falla instanceof Error ? falla.message : 'Entrada inválida';
      invalidas.push({
        indice,
        error: /FOREIGN KEY/i.test(mensaje) ? 'La jurisdicción no existe' : mensaje,
      });
      continue;
    }

    if (insertado.meta.changes === 0) {
      repetidas += 1;
      continue;
    }

    nuevas += 1;
    await c.env.DB.prepare("INSERT INTO cola_trabajo (catalogo_id, motivo, prioridad) VALUES (?, 'nueva', ?)")
      .bind(insertado.meta.last_row_id, prioridad)
      .run();
  }

  return c.json({ nuevas, repetidas, invalidas });
});

ingest.get('/trabajo', async (c) => {
  const limite = normalizarLimite(c.req.query('limite'));
  const ahora = new Date();
  const ahoraIso = ahora.toISOString();
  const limiteToma = new Date(ahora.getTime() - HORAS_TOMA * 60 * 60 * 1000).toISOString();

  const candidatos = await c.env.DB.prepare(
    `SELECT id FROM cola_trabajo
     WHERE cerrado_en IS NULL AND (tomado_en IS NULL OR tomado_en < ?)
     ORDER BY prioridad ASC, creado_en ASC, id ASC
     LIMIT ?`,
  )
    .bind(limiteToma, limite)
    .all<{ id: number }>();

  if (candidatos.results.length === 0) return c.json([]);

  const ids = candidatos.results.map((fila) => fila.id);
  const marcadores = ids.map(() => '?').join(',');
  const tomados = await c.env.DB.prepare(
    `UPDATE cola_trabajo SET tomado_en = ?
     WHERE id IN (${marcadores}) AND cerrado_en IS NULL AND (tomado_en IS NULL OR tomado_en < ?)
     RETURNING id, catalogo_id, variante_id, motivo, prioridad, creado_en`,
  )
    .bind(ahoraIso, ...ids, limiteToma)
    .all<FilaItemTrabajo>();

  const filas = [...tomados.results].sort(
    (a, b) => a.prioridad - b.prioridad || a.creado_en.localeCompare(b.creado_en) || a.id - b.id,
  );

  const items = await Promise.all(
    filas.map(async (fila) => ({
      cola_trabajo_id: fila.id,
      motivo: fila.motivo,
      catalogo: fila.catalogo_id === null ? null : await leerCatalogo(c.env.DB, fila.catalogo_id),
      variante: fila.variante_id === null ? null : await leerVariante(c.env.DB, fila.variante_id),
    })),
  );

  return c.json(items);
});

ingest.post('/borradores', async (c) => {
  const cuerpo = await leerJson(c);
  if (!esObjeto(cuerpo)) {
    return error(c, 400, 'cuerpo_invalido', 'Mandá un JSON con el borrador y el ítem de la cola.');
  }

  const colaTrabajoId = enteroPositivo(cuerpo.cola_trabajo_id);
  if (colaTrabajoId === null) {
    return error(c, 400, 'cola_trabajo_id_invalido', 'Falta el ítem de la cola de trabajo.');
  }

  const borrador = BorradorFicha.safeParse(cuerpo.borrador);
  if (!borrador.success) {
    return c.json(
      {
        error: {
          codigo: 'borrador_invalido',
          mensaje: 'El borrador no es válido.',
          detalles: borrador.error.issues,
        },
      },
      422,
    );
  }

  const resultado = await crearBorrador(c.env, { colaTrabajoId, borrador: borrador.data });
  if (!resultado) {
    return error(c, 404, 'cola_no_encontrada', 'No encontramos ese ítem de la cola de trabajo.');
  }

  return c.json(resultado, 201);
});

/**
 * Descarta una entrada del catálogo que no es un trámite (por ejemplo, una noticia del sitio municipal):
 * cierra sus ítems abiertos de la cola, la marca `descartado` para que no vuelva y, si ya se había
 * publicado, archiva la variante (y el trámite, si no le queda ninguna otra publicada).
 * Recibe `cola_trabajo_id` o `catalogo_id`.
 */
ingest.post('/descartar', async (c) => {
  const cuerpo = await leerJson(c);
  if (!esObjeto(cuerpo)) {
    return error(c, 400, 'cuerpo_invalido', 'Mandá un JSON con el ítem de la cola o la entrada del catálogo.');
  }

  let catalogoId = enteroPositivo(cuerpo.catalogo_id);
  const colaTrabajoId = enteroPositivo(cuerpo.cola_trabajo_id);
  if (catalogoId === null && colaTrabajoId !== null) {
    const item = await c.env.DB.prepare('SELECT catalogo_id FROM cola_trabajo WHERE id = ?')
      .bind(colaTrabajoId)
      .first<{ catalogo_id: number | null }>();
    if (!item) return error(c, 404, 'cola_no_encontrada', 'No encontramos ese ítem de la cola de trabajo.');
    catalogoId = item.catalogo_id;
  }
  if (catalogoId === null) {
    return error(c, 400, 'catalogo_requerido', 'Falta la entrada del catálogo a descartar.');
  }

  const entrada = await c.env.DB.prepare('SELECT id, tramite_id, variante_id FROM catalogo WHERE id = ?')
    .bind(catalogoId)
    .first<{ id: number; tramite_id: number | null; variante_id: number | null }>();
  if (!entrada) return error(c, 404, 'catalogo_no_encontrado', 'No encontramos esa entrada del catálogo.');

  const ahoraIso = new Date().toISOString();
  const sentencias = [
    c.env.DB.prepare("UPDATE catalogo SET estado = 'descartado', actualizado_en = ? WHERE id = ?").bind(ahoraIso, entrada.id),
    c.env.DB.prepare('UPDATE cola_trabajo SET cerrado_en = ? WHERE catalogo_id = ? AND cerrado_en IS NULL').bind(ahoraIso, entrada.id),
  ];
  if (entrada.variante_id !== null) {
    sentencias.push(
      c.env.DB.prepare("UPDATE variantes SET estado = 'archivada', actualizado_en = ? WHERE id = ?").bind(ahoraIso, entrada.variante_id),
      c.env.DB.prepare('UPDATE cola_trabajo SET cerrado_en = ? WHERE variante_id = ? AND cerrado_en IS NULL').bind(ahoraIso, entrada.variante_id),
    );
  }
  if (entrada.tramite_id !== null) {
    sentencias.push(
      c.env.DB.prepare(
        `UPDATE tramites SET estado = 'archivado'
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM variantes WHERE tramite_id = tramites.id AND estado = 'publicada')`,
      ).bind(entrada.tramite_id),
    );
  }
  await c.env.DB.batch(sentencias);

  return c.json({ catalogo_id: entrada.id, variante_archivada: entrada.variante_id });
});

ingest.post('/sin-cambios', async (c) => {
  const cuerpo = await leerJson(c);
  if (!esObjeto(cuerpo)) {
    return error(c, 400, 'cuerpo_invalido', 'Mandá un JSON con el ítem de la cola y la variante.');
  }

  const colaTrabajoId = enteroPositivo(cuerpo.cola_trabajo_id);
  if (colaTrabajoId === null) {
    return error(c, 400, 'cola_trabajo_id_invalido', 'Falta el ítem de la cola de trabajo.');
  }

  const item = await c.env.DB.prepare('SELECT id, variante_id FROM cola_trabajo WHERE id = ?')
    .bind(colaTrabajoId)
    .first<{ id: number; variante_id: number | null }>();
  if (!item) {
    return error(c, 404, 'cola_no_encontrada', 'No encontramos ese ítem de la cola de trabajo.');
  }

  const varianteId = enteroPositivo(cuerpo.variante_id) ?? item.variante_id;
  if (varianteId === null) {
    return error(c, 400, 'variante_requerida', 'Falta la variante que se revisó.');
  }

  const notasBrutas = cuerpo.notas ?? cuerpo.nota;
  if (notasBrutas !== undefined && notasBrutas !== null && typeof notasBrutas !== 'string') {
    return error(c, 400, 'notas_invalidas', 'Las notas tienen que ser texto.');
  }
  const notas = typeof notasBrutas === 'string' ? notasBrutas : null;

  const variante = await c.env.DB.prepare('SELECT id FROM variantes WHERE id = ?')
    .bind(varianteId)
    .first<{ id: number }>();
  if (!variante) {
    return error(c, 404, 'variante_no_encontrada', 'No encontramos esa ficha.');
  }

  const ahora = new Date();
  const verificadoEn = ahora.toISOString();
  const proximaRevision = new Date(ahora.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const resultados = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO verificaciones (variante_id, fecha, autor, resultado, notas)
       VALUES (?, ?, 'ia', 'sin_cambios', ?)`,
    ).bind(varianteId, verificadoEn, notas),
    c.env.DB.prepare(
      `UPDATE variantes
       SET verificado_en = ?, proxima_revision = ?, verificacion = 'verificado'
       WHERE id = ?`,
    ).bind(verificadoEn, proximaRevision, varianteId),
    c.env.DB.prepare('UPDATE cola_trabajo SET cerrado_en = ? WHERE id = ?').bind(verificadoEn, item.id),
  ]);

  return c.json({
    ok: true,
    id: resultados[0]?.meta.last_row_id ?? 0,
    verificado_en: verificadoEn,
    proxima_revision: proximaRevision,
  });
});
