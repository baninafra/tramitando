/**
 * API de administración del dashboard (`/admin/v1`, Cloudflare Access).
 * Especificación: docs/arquitectura.md, sección "Admin".
 */
import { Hono, type Context } from 'hono';
import { BorradorTema } from '@tramitando/shared';
import type { Env } from '../env';
import { error } from '../util/errores';
import { requiereAccess } from '../util/access';
import { ErrorAplicacion, aplicarBorrador, validarPayload, type BorradorAprobable } from '../borradores/aplicar';
import { reindexarTramite } from '../fts';

export const admin = new Hono<{ Bindings: Env }>();

admin.use('*', requiereAccess);

type Ctx = Context<{ Bindings: Env }>;

const POR_PAGINA = 50;

interface TemaFila {
  id: number;
  tipo: 'tema' | 'situacion';
  slug: string;
  nombre: string;
  descripcion: string;
  icono: string | null;
  padre_id: number | null;
  orden: number;
  en_portada: number;
  estado: 'propuesto' | 'activo' | 'archivado';
}

interface BorradorFila extends BorradorAprobable {
  diff: string | null;
  chequeos: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  motivo: string | null;
  creado_en: string;
  revisado_en: string | null;
}

function parsearJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

async function leerCuerpo(c: Ctx): Promise<Record<string, unknown> | null> {
  const texto = await c.req.text();
  if (texto.trim() === '') return {};
  const valor = parsearJson(texto);
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

function idDeRuta(c: Ctx): number | null {
  const id = Number(c.req.param('id'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function traducirError(c: Ctx, err: unknown) {
  if (err instanceof ErrorAplicacion) return error(c, err.status, err.codigo, err.message);
  throw err;
}

// ---------------------------------------------------------------------------------------------
// Cola de revisión
// ---------------------------------------------------------------------------------------------

admin.get('/cola', async (c) => {
  const pagina = Math.max(1, Number(c.req.query('pagina') ?? '1') || 1);
  const offset = (pagina - 1) * POR_PAGINA;
  const tipo = c.req.query('tipo');

  const filtroBorrador = tipo === 'reporte' ? ' AND 0 = 1' : '';
  const filtroReporte = tipo === 'borrador' ? ' AND 0 = 1' : '';

  const union = `
    SELECT 'borrador' AS tipo, b.id AS id, b.tipo AS clase, b.creado_en AS creado_en,
           COALESCE(t.nombre, cat.nombre_oficial) AS tramite_nombre,
           t.popularidad AS popularidad
    FROM borradores b
    LEFT JOIN variantes v ON v.id = b.variante_id
    LEFT JOIN tramites t ON t.id = v.tramite_id
    LEFT JOIN catalogo cat ON cat.id = b.catalogo_id
    WHERE b.estado = 'pendiente'${filtroBorrador}
    UNION ALL
    SELECT 'reporte', r.id, 'reporte', r.creado_en, t.nombre, t.popularidad
    FROM reportes r
    INNER JOIN variantes v ON v.id = r.variante_id
    INNER JOIN tramites t ON t.id = v.tramite_id
    WHERE r.estado = 'pendiente'${filtroReporte}`;

  const [items, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM (${union})
       ORDER BY (popularidad IS NULL) ASC, popularidad ASC, creado_en ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(POR_PAGINA, offset)
      .all<{
        tipo: 'borrador' | 'reporte';
        id: number;
        clase: string;
        creado_en: string;
        tramite_nombre: string | null;
        popularidad: number | null;
      }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM (${union})`).first<{ total: number }>(),
  ]);

  return c.json({ items: items.results, pagina, por_pagina: POR_PAGINA, total: total?.total ?? 0 });
});

// ---------------------------------------------------------------------------------------------
// Borradores
// ---------------------------------------------------------------------------------------------

admin.get('/borradores/:id', async (c) => {
  const id = idDeRuta(c);
  if (id === null) return error(c, 400, 'id_invalido', 'El borrador no existe.');

  const borrador = await c.env.DB.prepare('SELECT * FROM borradores WHERE id = ?').bind(id).first<BorradorFila>();
  if (!borrador) return error(c, 404, 'no_encontrado', 'No encontramos ese borrador.');

  let variante = null;
  if (borrador.variante_id !== null) {
    variante = await c.env.DB.prepare(
      `SELECT v.*, t.slug AS tramite_slug, t.nombre AS tramite_nombre
       FROM variantes v INNER JOIN tramites t ON t.id = v.tramite_id
       WHERE v.id = ?`,
    )
      .bind(borrador.variante_id)
      .first();
  }

  return c.json({
    ...borrador,
    payload: parsearJson(borrador.payload),
    diff: borrador.diff === null ? null : parsearJson(borrador.diff),
    chequeos: parsearJson(borrador.chequeos) ?? [],
    variante,
  });
});

admin.post('/borradores/:id/aprobar', async (c) => {
  const id = idDeRuta(c);
  if (id === null) return error(c, 400, 'id_invalido', 'El borrador no existe.');

  const borrador = await c.env.DB.prepare('SELECT * FROM borradores WHERE id = ?').bind(id).first<BorradorFila>();
  if (!borrador) return error(c, 404, 'no_encontrado', 'No encontramos ese borrador.');
  if (borrador.estado !== 'pendiente') {
    return error(c, 409, 'borrador_ya_revisado', 'Ese borrador ya fue revisado.');
  }

  let payloadCrudo: unknown = parsearJson(borrador.payload);
  const cuerpo = await leerCuerpo(c);
  if (cuerpo === null) return error(c, 400, 'cuerpo_invalido', 'El cuerpo del pedido no es válido.');
  if (cuerpo.payload !== undefined) payloadCrudo = cuerpo.payload;

  try {
    const payload = validarPayload(borrador.tipo, payloadCrudo);
    const sentencias = await aplicarBorrador(c.env.DB, borrador, payload);
    await c.env.DB.batch(sentencias);
  } catch (err) {
    return traducirError(c, err);
  }

  return c.json({ id, estado: 'aprobado' });
});

admin.post('/borradores/:id/rechazar', async (c) => {
  const id = idDeRuta(c);
  if (id === null) return error(c, 400, 'id_invalido', 'El borrador no existe.');

  const cuerpo = await leerCuerpo(c);
  if (cuerpo === null) return error(c, 400, 'cuerpo_invalido', 'El cuerpo del pedido no es válido.');
  const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : '';
  if (motivo === '') return error(c, 400, 'motivo_requerido', 'Contanos por qué rechazás el borrador.');

  const borrador = await c.env.DB.prepare('SELECT * FROM borradores WHERE id = ?').bind(id).first<BorradorFila>();
  if (!borrador) return error(c, 404, 'no_encontrado', 'No encontramos ese borrador.');
  if (borrador.estado !== 'pendiente') {
    return error(c, 409, 'borrador_ya_revisado', 'Ese borrador ya fue revisado.');
  }

  const ahora = new Date().toISOString();
  const sentencias: D1PreparedStatement[] = [
    c.env.DB.prepare("UPDATE borradores SET estado = 'rechazado', motivo = ?, revisado_en = ? WHERE id = ?").bind(
      motivo,
      ahora,
      id,
    ),
  ];

  if (borrador.catalogo_id !== null) {
    sentencias.push(
      c.env.DB.prepare(
        "INSERT INTO cola_trabajo (catalogo_id, motivo, prioridad) VALUES (?, 'nueva', 500)",
      ).bind(borrador.catalogo_id),
    );
  }

  await c.env.DB.batch(sentencias);
  return c.json({ id, estado: 'rechazado' });
});

// ---------------------------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------------------------

admin.get('/reportes/:id', async (c) => {
  const id = idDeRuta(c);
  if (id === null) return error(c, 400, 'id_invalido', 'El reporte no existe.');

  const reporte = await c.env.DB.prepare('SELECT * FROM reportes WHERE id = ?').bind(id).first<{
    prueba_r2_key: string | null;
  }>();
  if (!reporte) return error(c, 404, 'no_encontrado', 'No encontramos ese reporte.');

  return c.json({
    ...reporte,
    prueba_ruta: reporte.prueba_r2_key ? `/admin/v1/pruebas/${reporte.prueba_r2_key}` : null,
  });
});

admin.get('/pruebas/*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const marcador = '/pruebas/';
  const indice = pathname.indexOf(marcador);
  const clave = indice === -1 ? '' : decodeURIComponent(pathname.slice(indice + marcador.length));

  if (!clave.startsWith('reportes/') || clave.includes('..')) {
    return error(c, 404, 'no_encontrado', 'No encontramos esa prueba.');
  }

  const objeto = await c.env.PRUEBAS.get(clave);
  if (!objeto) return error(c, 404, 'no_encontrado', 'No encontramos esa prueba.');

  return c.body(objeto.body, 200, {
    'Content-Type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'private, no-store',
  });
});

admin.post('/reportes/:id/aceptar', async (c) => {
  const id = idDeRuta(c);
  if (id === null) return error(c, 400, 'id_invalido', 'El reporte no existe.');

  const reporte = await c.env.DB.prepare('SELECT id, variante_id, estado FROM reportes WHERE id = ?')
    .bind(id)
    .first<{ id: number; variante_id: number; estado: string }>();
  if (!reporte) return error(c, 404, 'no_encontrado', 'No encontramos ese reporte.');
  if (reporte.estado !== 'pendiente') return error(c, 409, 'reporte_ya_revisado', 'Ese reporte ya fue revisado.');

  const ahora = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE reportes SET estado = 'aceptado', email = NULL, cerrado_en = ? WHERE id = ?",
    ).bind(ahora, id),
    c.env.DB.prepare(
      "INSERT INTO cola_trabajo (variante_id, motivo, prioridad) VALUES (?, 'reporte', 1)",
    ).bind(reporte.variante_id),
  ]);

  return c.json({ id, estado: 'aceptado' });
});

admin.post('/reportes/:id/rechazar', async (c) => {
  const id = idDeRuta(c);
  if (id === null) return error(c, 400, 'id_invalido', 'El reporte no existe.');

  const cuerpo = await leerCuerpo(c);
  if (cuerpo === null) return error(c, 400, 'cuerpo_invalido', 'El cuerpo del pedido no es válido.');
  const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : '';
  if (motivo === '') return error(c, 400, 'motivo_requerido', 'Contanos por qué rechazás el reporte.');

  const reporte = await c.env.DB.prepare('SELECT id, estado FROM reportes WHERE id = ?')
    .bind(id)
    .first<{ id: number; estado: string }>();
  if (!reporte) return error(c, 404, 'no_encontrado', 'No encontramos ese reporte.');
  if (reporte.estado !== 'pendiente') return error(c, 409, 'reporte_ya_revisado', 'Ese reporte ya fue revisado.');

  await c.env.DB.prepare(
    "UPDATE reportes SET estado = 'rechazado', motivo = ?, email = NULL, cerrado_en = ? WHERE id = ?",
  )
    .bind(motivo, new Date().toISOString(), id)
    .run();

  return c.json({ id, estado: 'rechazado' });
});

// ---------------------------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------------------------

admin.get('/temas', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, tipo, slug, nombre, descripcion, icono, padre_id, orden, en_portada, estado
     FROM temas ORDER BY orden ASC, nombre ASC`,
  ).all<TemaFila>();

  const nodos = new Map<number, TemaFila & { hijos: (TemaFila & { hijos: unknown[] })[] }>();
  for (const fila of results) nodos.set(fila.id, { ...fila, hijos: [] });

  const raices: (TemaFila & { hijos: unknown[] })[] = [];
  for (const fila of results) {
    const nodo = nodos.get(fila.id)!;
    const padre = fila.padre_id === null ? undefined : nodos.get(fila.padre_id);
    if (padre) padre.hijos.push(nodo);
    else raices.push(nodo);
  }

  return c.json({
    temas: raices.filter((t) => t.tipo !== 'situacion'),
    situaciones: raices.filter((t) => t.tipo === 'situacion'),
  });
});

admin.post('/temas', async (c) => {
  const cuerpo = await leerCuerpo(c);
  if (cuerpo === null) return error(c, 400, 'cuerpo_invalido', 'El cuerpo del pedido no es válido.');

  const resultado = BorradorTema.safeParse(cuerpo);
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    return error(c, 422, 'tema_invalido', problema?.message ?? 'El tema no es válido.');
  }
  const tema = resultado.data;

  if (tema.padre !== null) {
    const padre = await c.env.DB.prepare("SELECT id FROM temas WHERE slug = ? AND estado != 'archivado'")
      .bind(tema.padre)
      .first<{ id: number }>();
    if (!padre) return error(c, 422, 'tema_padre_inexistente', `No existe el tema padre "${tema.padre}".`);
  }

  const existente = await c.env.DB.prepare('SELECT id FROM temas WHERE slug = ?').bind(tema.slug).first();
  if (existente) return error(c, 409, 'tema_duplicado', 'Ya hay un tema con ese slug.');

  await c.env.DB.prepare(
    `INSERT INTO temas (slug, nombre, descripcion, tipo, padre_id)
     VALUES (?, ?, ?, ?, (SELECT id FROM temas WHERE slug = ?))`,
  )
    .bind(tema.slug, tema.nombre, tema.descripcion, tema.tipo, tema.padre)
    .run();

  const creado = await c.env.DB.prepare('SELECT * FROM temas WHERE slug = ?').bind(tema.slug).first();
  return c.json(creado, 201);
});

admin.patch('/temas/:slug', async (c) => {
  const slug = c.req.param('slug');
  const actual = await c.env.DB.prepare('SELECT * FROM temas WHERE slug = ?').bind(slug).first<TemaFila>();
  if (!actual) return error(c, 404, 'no_encontrado', 'No encontramos ese tema.');

  const cuerpo = await leerCuerpo(c);
  if (cuerpo === null) return error(c, 400, 'cuerpo_invalido', 'El cuerpo del pedido no es válido.');

  const campos: string[] = [];
  const valores: unknown[] = [];
  const agregar = (columna: string, valor: unknown) => {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  };

  let slugNuevo = actual.slug;
  let cambiaNombre = false;

  if (cuerpo.nombre !== undefined) {
    if (typeof cuerpo.nombre !== 'string' || cuerpo.nombre.trim().length < 2 || cuerpo.nombre.length > 60) {
      return error(c, 422, 'nombre_invalido', 'El nombre tiene que tener entre 2 y 60 caracteres.');
    }
    agregar('nombre', cuerpo.nombre.trim());
    cambiaNombre = cuerpo.nombre.trim() !== actual.nombre;
  }
  if (cuerpo.descripcion !== undefined) {
    if (typeof cuerpo.descripcion !== 'string' || cuerpo.descripcion.length > 200) {
      return error(c, 422, 'descripcion_invalida', 'La descripción no puede pasar los 200 caracteres.');
    }
    agregar('descripcion', cuerpo.descripcion);
  }
  if (cuerpo.icono !== undefined) {
    if (cuerpo.icono !== null && typeof cuerpo.icono !== 'string') {
      return error(c, 422, 'icono_invalido', 'El ícono no es válido.');
    }
    agregar('icono', cuerpo.icono);
  }
  if (cuerpo.orden !== undefined) {
    if (typeof cuerpo.orden !== 'number' || !Number.isInteger(cuerpo.orden)) {
      return error(c, 422, 'orden_invalido', 'El orden tiene que ser un número entero.');
    }
    agregar('orden', cuerpo.orden);
  }
  if (cuerpo.en_portada !== undefined) {
    if (typeof cuerpo.en_portada !== 'boolean' && cuerpo.en_portada !== 0 && cuerpo.en_portada !== 1) {
      return error(c, 422, 'en_portada_invalido', 'en_portada tiene que ser verdadero o falso.');
    }
    agregar('en_portada', cuerpo.en_portada ? 1 : 0);
  }
  if (cuerpo.estado !== undefined) {
    if (cuerpo.estado !== 'propuesto' && cuerpo.estado !== 'activo' && cuerpo.estado !== 'archivado') {
      return error(c, 422, 'estado_invalido', 'El estado no es válido.');
    }
    agregar('estado', cuerpo.estado);
  }
  if (cuerpo.slug !== undefined) {
    if (typeof cuerpo.slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cuerpo.slug)) {
      return error(c, 422, 'slug_invalido', 'El slug solo puede tener minúsculas, números y guiones.');
    }
    if (cuerpo.slug !== actual.slug) {
      const ocupado = await c.env.DB.prepare('SELECT id FROM temas WHERE slug = ?').bind(cuerpo.slug).first();
      if (ocupado) return error(c, 409, 'slug_duplicado', 'Ya hay un tema con ese slug.');
      slugNuevo = cuerpo.slug;
      agregar('slug', cuerpo.slug);
    }
  }

  if (campos.length === 0) return c.json(actual);

  const sentencias: D1PreparedStatement[] = [];

  if (slugNuevo !== actual.slug) {
    sentencias.push(
      c.env.DB.prepare(
        "INSERT OR REPLACE INTO slugs_historicos (tipo, slug_viejo, slug_nuevo) VALUES ('tema', ?, ?)",
      ).bind(actual.slug, slugNuevo),
    );
  }

  sentencias.push(
    c.env.DB.prepare(`UPDATE temas SET ${campos.join(', ')} WHERE id = ?`).bind(...valores, actual.id),
  );

  if (cambiaNombre) {
    const { results } = await c.env.DB.prepare('SELECT tramite_id FROM tramite_temas WHERE tema_id = ?')
      .bind(actual.id)
      .all<{ tramite_id: number }>();
    for (const fila of results) sentencias.push(...reindexarTramite(c.env.DB, fila.tramite_id));
  }

  await c.env.DB.batch(sentencias);

  const actualizado = await c.env.DB.prepare('SELECT * FROM temas WHERE id = ?').bind(actual.id).first();
  return c.json(actualizado);
});

// ---------------------------------------------------------------------------------------------
// Cobertura y salud
// ---------------------------------------------------------------------------------------------

admin.get('/cobertura', async (c) => {
  const [provincias, catalogo, cola] = await Promise.all([
    c.env.DB.prepare(
      `SELECT j.id, j.nombre,
              COUNT(v.id) AS fichas,
              COALESCE(SUM(CASE WHEN v.verificacion = 'verificado' THEN 1 ELSE 0 END), 0) AS verificadas,
              COALESCE(SUM(CASE WHEN v.verificacion = 'revisar' THEN 1 ELSE 0 END), 0) AS por_revisar
       FROM jurisdicciones j
       LEFT JOIN variantes v ON v.jurisdiccion_id = j.id AND v.estado = 'publicada'
       WHERE j.nivel = 'provincia'
       GROUP BY j.id
       ORDER BY j.nombre ASC`,
    ).all(),
    c.env.DB.prepare('SELECT estado, COUNT(*) AS cantidad FROM catalogo GROUP BY estado ORDER BY estado').all(),
    c.env.DB.prepare(
      'SELECT motivo, COUNT(*) AS cantidad FROM cola_trabajo WHERE cerrado_en IS NULL GROUP BY motivo ORDER BY motivo',
    ).all(),
  ]);

  return c.json({ provincias: provincias.results, catalogo: catalogo.results, cola: cola.results });
});

admin.get('/salud', async (c) => {
  const [caidas, cambios, vencidas] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, url, estado_http, ultimo_chequeo
       FROM fuentes
       WHERE estado_http IS NULL OR estado_http = 0 OR estado_http >= 400
       ORDER BY ultimo_chequeo ASC`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, url, cambio_detectado_en
       FROM fuentes
       WHERE cambio_detectado_en IS NOT NULL
       ORDER BY cambio_detectado_en ASC`,
    ).all(),
    c.env.DB.prepare(
      `SELECT v.id, t.slug AS tramite_slug, t.nombre AS tramite_nombre, v.jurisdiccion_id, v.proxima_revision
       FROM variantes v
       INNER JOIN tramites t ON t.id = v.tramite_id
       WHERE v.estado = 'publicada' AND v.proxima_revision < ?
       ORDER BY v.proxima_revision ASC`,
    )
      .bind(new Date().toISOString())
      .all(),
  ]);

  return c.json({
    fuentes_caidas: caidas.results,
    cambios_sin_revisar: cambios.results,
    variantes_vencidas: vencidas.results,
  });
});
