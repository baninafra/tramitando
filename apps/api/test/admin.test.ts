import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { admin } from '../src/rutas/admin';
import {
  URL_FUENTE,
  URL_FUENTE_2,
  crearCatalogo,
  fichaEjemplo,
  insertarBorrador,
  insertarReporte,
  limpiarBase,
  sembrarBase,
  sembrarTramiteYVariante,
  temaEjemplo,
} from './fixtures/admin';

beforeEach(async () => {
  await limpiarBase(env.DB);
});

async function post(ruta: string, cuerpo?: unknown): Promise<Response> {
  return SELF.fetch(`https://api.test${ruta}`, {
    method: 'POST',
    headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

async function patch(ruta: string, cuerpo: unknown): Promise<Response> {
  return SELF.fetch(`https://api.test${ruta}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

describe('aprobar una ficha nueva', () => {
  it('publica el trámite y todo lo asociado en una sola transacción', async () => {
    await sembrarBase(env.DB);
    const catalogoId = await crearCatalogo(env.DB, URL_FUENTE_2);

    await env.DB.prepare('INSERT INTO fuentes (url, titulo, cambio_detectado_en) VALUES (?, ?, ?)')
      .bind(URL_FUENTE, 'RENAPER', new Date().toISOString())
      .run();

    const borradorId = await insertarBorrador(env.DB, fichaEjemplo(), { catalogo_id: catalogoId });

    const res = await post(`/admin/v1/borradores/${borradorId}/aprobar`);
    expect(res.status).toBe(200);

    const tramite = await env.DB.prepare('SELECT * FROM tramites WHERE slug = ?').bind('renovar-dni').first<{
      id: number;
      nombre: string;
      nombre_busqueda: string;
      resumen: string;
      sinonimos: string;
    }>();
    expect(tramite).not.toBeNull();
    expect(tramite!.nombre).toBe('Renovación de DNI');
    expect(tramite!.nombre_busqueda).toBe('Renovar el DNI');
    expect(JSON.parse(tramite!.sinonimos)).toEqual(['renovar documento', 'dni vencido']);

    const temas = await env.DB.prepare(
      `SELECT t.slug, tt.principal FROM tramite_temas tt
       INNER JOIN temas t ON t.id = tt.tema_id
       WHERE tt.tramite_id = ? ORDER BY tt.principal DESC, t.slug`,
    )
      .bind(tramite!.id)
      .all<{ slug: string; principal: number }>();
    expect(temas.results).toEqual([
      { slug: 'documentos', principal: 1 },
      { slug: 'identidad', principal: 0 },
    ]);

    const organismo = await env.DB.prepare('SELECT * FROM organismos WHERE nombre = ?').bind('RENAPER').first<{
      id: number;
      slug: string;
      jurisdiccion_id: string;
      sigla: string;
    }>();
    expect(organismo).not.toBeNull();
    expect(organismo!.jurisdiccion_id).toBe('nacion');
    expect(organismo!.sigla).toBe('RENAPER');

    const variante = await env.DB.prepare('SELECT * FROM variantes WHERE tramite_id = ?').bind(tramite!.id).first<{
      id: number;
      version: number;
      verificacion: string;
      verificado_en: string;
      proxima_revision: string;
      contenido: string;
      organismo_id: number | null;
    }>();
    expect(variante).not.toBeNull();
    expect(variante!.version).toBe(1);
    expect(variante!.verificacion).toBe('verificado');
    expect(variante!.organismo_id).toBe(organismo!.id);
    const contenido = JSON.parse(variante!.contenido);
    expect(contenido.plazo).toBe('15 días hábiles');
    const dias = (new Date(variante!.proxima_revision).getTime() - new Date(variante!.verificado_en).getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(90);

    const costos = await env.DB.prepare('SELECT * FROM costos WHERE variante_id = ?').bind(variante!.id).all<{
      modalidad: string;
      monto_centavos: number;
      gratis: number;
      fuente_id: number | null;
    }>();
    expect(costos.results).toHaveLength(1);
    expect(costos.results[0]!.modalidad).toBe('Trámite normal');
    expect(costos.results[0]!.monto_centavos).toBe(1_250_000);
    expect(costos.results[0]!.fuente_id).not.toBeNull();

    const oficinas = await env.DB.prepare('SELECT * FROM oficinas WHERE organismo_id = ?').bind(organismo!.id).all();
    expect(oficinas.results).toHaveLength(1);

    const fuentes = await env.DB.prepare('SELECT * FROM variante_fuentes WHERE variante_id = ?').bind(variante!.id).all();
    expect(fuentes.results).toHaveLength(8);

    const verificaciones = await env.DB.prepare(
      'SELECT autor, resultado FROM verificaciones WHERE variante_id = ?',
    )
      .bind(variante!.id)
      .all();
    expect(verificaciones.results).toEqual([{ autor: 'admin', resultado: 'creada' }]);

    const fts = await env.DB.prepare(
      "SELECT tramite_id, nombre, temas FROM tramites_fts WHERE tramites_fts MATCH 'dni'",
    ).all<{ tramite_id: number; nombre: string; temas: string }>();
    expect(fts.results).toHaveLength(1);
    expect(fts.results[0]!.tramite_id).toBe(tramite!.id);
    expect(fts.results[0]!.temas).toContain('Documentos');
    expect(fts.results[0]!.temas).toContain('Identidad');

    const catalogo = await env.DB.prepare('SELECT * FROM catalogo WHERE id = ?').bind(catalogoId).first<{
      estado: string;
      tramite_id: number;
      variante_id: number;
    }>();
    expect(catalogo!.estado).toBe('publicado');
    expect(catalogo!.tramite_id).toBe(tramite!.id);
    expect(catalogo!.variante_id).toBe(variante!.id);

    const fuente = await env.DB.prepare('SELECT cambio_detectado_en FROM fuentes WHERE url = ?')
      .bind(URL_FUENTE)
      .first<{ cambio_detectado_en: string | null }>();
    expect(fuente!.cambio_detectado_en).toBeNull();

    const borrador = await env.DB.prepare('SELECT estado, revisado_en FROM borradores WHERE id = ?')
      .bind(borradorId)
      .first<{ estado: string; revisado_en: string | null }>();
    expect(borrador!.estado).toBe('aprobado');
    expect(borrador!.revisado_en).not.toBeNull();
  });
});

describe('aprobar una actualización', () => {
  it('sube la versión y reemplaza costos', async () => {
    await sembrarBase(env.DB);
    const borradorNuevo = await insertarBorrador(env.DB, fichaEjemplo());
    expect((await post(`/admin/v1/borradores/${borradorNuevo}/aprobar`)).status).toBe(200);

    const variante = await env.DB.prepare(
      `SELECT v.id FROM variantes v INNER JOIN tramites t ON t.id = v.tramite_id WHERE t.slug = ?`,
    )
      .bind('renovar-dni')
      .first<{ id: number }>();

    const actualizada = fichaEjemplo({
      costos: [
        {
          modalidad: 'Exprés',
          gratis: false,
          monto_centavos: 2_000_000,
          vigente_desde: '2026-06-01',
          nota: null,
          fuente_url: URL_FUENTE,
        },
      ],
    });
    const borradorUpdate = await insertarBorrador(env.DB, actualizada, {
      tipo: 'actualizacion',
      variante_id: variante!.id,
    });

    const res = await post(`/admin/v1/borradores/${borradorUpdate}/aprobar`);
    expect(res.status).toBe(200);

    const filas = await env.DB.prepare('SELECT version, id FROM variantes WHERE tramite_id = (SELECT id FROM tramites WHERE slug = ?)')
      .bind('renovar-dni')
      .all<{ id: number; version: number }>();
    expect(filas.results).toHaveLength(1);
    expect(filas.results[0]!.version).toBe(2);

    const costos = await env.DB.prepare('SELECT modalidad FROM costos WHERE variante_id = ? ORDER BY orden')
      .bind(filas.results[0]!.id)
      .all<{ modalidad: string }>();
    expect(costos.results).toEqual([{ modalidad: 'Exprés' }]);

    const verificaciones = await env.DB.prepare(
      'SELECT resultado FROM verificaciones WHERE variante_id = ? ORDER BY id',
    )
      .bind(filas.results[0]!.id)
      .all<{ resultado: string }>();
    expect(verificaciones.results.map((v) => v.resultado)).toEqual(['creada', 'actualizada']);
  });
});

describe('validaciones al aprobar', () => {
  it('rechaza con 422 si el tema todavía no está aprobado', async () => {
    await sembrarBase(env.DB);
    const borradorId = await insertarBorrador(
      env.DB,
      fichaEjemplo({ temas: ['documentos', 'tema-propuesto'] }),
    );

    const res = await post(`/admin/v1/borradores/${borradorId}/aprobar`);
    expect(res.status).toBe(422);
    const cuerpo = (await res.json()) as { error: { codigo: string; mensaje: string } };
    expect(cuerpo.error.codigo).toBe('tema_no_activo');
    expect(cuerpo.error.mensaje).toContain('tema-propuesto');

    const tramite = await env.DB.prepare('SELECT COUNT(*) AS total FROM tramites').first<{ total: number }>();
    expect(tramite!.total).toBe(0);
    const borrador = await env.DB.prepare('SELECT estado FROM borradores WHERE id = ?').bind(borradorId).first<{
      estado: string;
    }>();
    expect(borrador!.estado).toBe('pendiente');
  });

  it('no deja aprobar dos veces el mismo borrador', async () => {
    await sembrarBase(env.DB);
    const borradorId = await insertarBorrador(env.DB, fichaEjemplo());

    expect((await post(`/admin/v1/borradores/${borradorId}/aprobar`)).status).toBe(200);
    const res = await post(`/admin/v1/borradores/${borradorId}/aprobar`);
    expect(res.status).toBe(409);
    const cuerpo = (await res.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe('borrador_ya_revisado');
  });

  it('acepta un payload editado y lo valida', async () => {
    await sembrarBase(env.DB);
    const borradorId = await insertarBorrador(env.DB, fichaEjemplo());

    const invalido = await post(`/admin/v1/borradores/${borradorId}/aprobar`, { payload: { tramite: {} } });
    expect(invalido.status).toBe(422);

    const editado = fichaEjemplo({ nombre: 'Renovación de DNI (editado)' });
    const res = await post(`/admin/v1/borradores/${borradorId}/aprobar`, { payload: editado });
    expect(res.status).toBe(200);

    const tramite = await env.DB.prepare('SELECT nombre FROM tramites WHERE slug = ?').bind('renovar-dni').first<{
      nombre: string;
    }>();
    expect(tramite!.nombre).toBe('Renovación de DNI (editado)');
  });
});

describe('rechazar un borrador', () => {
  it('guarda el motivo y reabre el trabajo del catálogo', async () => {
    await sembrarBase(env.DB);
    const catalogoId = await crearCatalogo(env.DB);
    const borradorId = await insertarBorrador(env.DB, fichaEjemplo(), { catalogo_id: catalogoId });

    const sinMotivo = await post(`/admin/v1/borradores/${borradorId}/rechazar`, {});
    expect(sinMotivo.status).toBe(400);

    const res = await post(`/admin/v1/borradores/${borradorId}/rechazar`, { motivo: 'Falta la fuente del plazo' });
    expect(res.status).toBe(200);

    const borrador = await env.DB.prepare('SELECT estado, motivo, revisado_en FROM borradores WHERE id = ?')
      .bind(borradorId)
      .first<{ estado: string; motivo: string; revisado_en: string | null }>();
    expect(borrador!.estado).toBe('rechazado');
    expect(borrador!.motivo).toBe('Falta la fuente del plazo');
    expect(borrador!.revisado_en).not.toBeNull();

    const cola = await env.DB.prepare('SELECT * FROM cola_trabajo WHERE catalogo_id = ?').bind(catalogoId).all<{
      prioridad: number;
      motivo: string;
      cerrado_en: string | null;
    }>();
    expect(cola.results).toHaveLength(1);
    expect(cola.results[0]!.prioridad).toBe(500);
    expect(cola.results[0]!.motivo).toBe('nueva');
    expect(cola.results[0]!.cerrado_en).toBeNull();
  });
});

describe('temas', () => {
  it('aprueba un tema propuesto', async () => {
    await sembrarBase(env.DB);
    const temaId = await env.DB.prepare("INSERT INTO temas (slug, nombre, descripcion, tipo, estado) VALUES ('transporte', 'Transporte', '', 'tema', 'propuesto') RETURNING id")
      .first<{ id: number }>();
    const borradorId = await insertarBorrador(
      env.DB,
      temaEjemplo({ slug: 'transporte', nombre: 'Transporte' }),
      { tipo: 'tema_nuevo' },
    );

    const res = await post(`/admin/v1/borradores/${borradorId}/aprobar`);
    expect(res.status).toBe(200);

    const tema = await env.DB.prepare('SELECT nombre, estado FROM temas WHERE id = ?').bind(temaId!.id).first<{
      nombre: string;
      estado: string;
    }>();
    expect(tema).toEqual({ nombre: 'Transporte', estado: 'activo' });

    const borrador = await env.DB.prepare('SELECT estado FROM borradores WHERE id = ?').bind(borradorId).first<{
      estado: string;
    }>();
    expect(borrador!.estado).toBe('aprobado');
  });

  it('crea un tema, cambia su slug y guarda el histórico', async () => {
    await sembrarBase(env.DB);

    const creado = await post('/admin/v1/temas', {
      slug: 'identidad-digital',
      nombre: 'Identidad digital',
      descripcion: 'Trámites de identidad',
      tipo: 'tema',
      padre: 'documentos',
    });
    expect(creado.status).toBe(201);

    const res = await patch('/admin/v1/temas/identidad-digital', { slug: 'mi-identidad', en_portada: true });
    expect(res.status).toBe(200);
    const actualizado = (await res.json()) as { slug: string; en_portada: number };
    expect(actualizado.slug).toBe('mi-identidad');
    expect(actualizado.en_portada).toBe(1);

    const historico = await env.DB.prepare(
      "SELECT slug_nuevo FROM slugs_historicos WHERE tipo = 'tema' AND slug_viejo = ?",
    )
      .bind('identidad-digital')
      .first<{ slug_nuevo: string }>();
    expect(historico!.slug_nuevo).toBe('mi-identidad');
  });

  it('reindexa los trámites del tema cuando cambia el nombre', async () => {
    await sembrarBase(env.DB);
    const { tramiteId } = await sembrarTramiteYVariante(env.DB);
    const tema = await env.DB.prepare("SELECT id FROM temas WHERE slug = 'identidad'").first<{ id: number }>();
    await env.DB.prepare('INSERT INTO tramite_temas (tramite_id, tema_id, principal) VALUES (?, ?, 1)')
      .bind(tramiteId, tema!.id)
      .run();

    const res = await patch('/admin/v1/temas/identidad', { nombre: 'Identidad y documentos' });
    expect(res.status).toBe(200);

    const fts = await env.DB.prepare('SELECT temas FROM tramites_fts WHERE tramite_id = ?')
      .bind(tramiteId)
      .first<{ temas: string }>();
    expect(fts!.temas).toContain('Identidad y documentos');
  });
});

describe('reportes', () => {
  it('acepta un reporte y encola el trabajo', async () => {
    await sembrarBase(env.DB);
    const { varianteId } = await sembrarTramiteYVariante(env.DB);
    const reporteId = await insertarReporte(env.DB, varianteId);

    const res = await post(`/admin/v1/reportes/${reporteId}/aceptar`);
    expect(res.status).toBe(200);

    const reporte = await env.DB.prepare('SELECT estado, email, cerrado_en FROM reportes WHERE id = ?')
      .bind(reporteId)
      .first<{ estado: string; email: string | null; cerrado_en: string | null }>();
    expect(reporte!.estado).toBe('aceptado');
    expect(reporte!.email).toBeNull();
    expect(reporte!.cerrado_en).not.toBeNull();

    const cola = await env.DB.prepare('SELECT * FROM cola_trabajo WHERE variante_id = ?').bind(varianteId).all<{
      motivo: string;
      prioridad: number;
      cerrado_en: string | null;
    }>();
    expect(cola.results).toHaveLength(1);
    expect(cola.results[0]!.motivo).toBe('reporte');
    expect(cola.results[0]!.prioridad).toBe(1);
    expect(cola.results[0]!.cerrado_en).toBeNull();
  });

  it('rechaza un reporte con motivo y borra el email', async () => {
    await sembrarBase(env.DB);
    const { varianteId } = await sembrarTramiteYVariante(env.DB);
    const reporteId = await insertarReporte(env.DB, varianteId);

    const res = await post(`/admin/v1/reportes/${reporteId}/rechazar`, { motivo: 'No pudimos comprobar el dato' });
    expect(res.status).toBe(200);

    const reporte = await env.DB.prepare('SELECT estado, motivo, email, cerrado_en FROM reportes WHERE id = ?')
      .bind(reporteId)
      .first<{ estado: string; motivo: string; email: string | null; cerrado_en: string | null }>();
    expect(reporte!.estado).toBe('rechazado');
    expect(reporte!.motivo).toBe('No pudimos comprobar el dato');
    expect(reporte!.email).toBeNull();
    expect(reporte!.cerrado_en).not.toBeNull();
  });

  it('devuelve la ruta de la prueba y sirve el archivo de R2', async () => {
    await sembrarBase(env.DB);
    const { varianteId } = await sembrarTramiteYVariante(env.DB);
    const clave = 'reportes/prueba.png';
    await env.PRUEBAS.put(clave, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } });
    const reporteId = await insertarReporte(env.DB, varianteId, { r2Key: clave });

    const res = await SELF.fetch(`https://api.test/admin/v1/reportes/${reporteId}`);
    expect(res.status).toBe(200);
    const reporte = (await res.json()) as { prueba_ruta: string | null };
    expect(reporte.prueba_ruta).toBe(`/admin/v1/pruebas/${clave}`);

    const archivo = await SELF.fetch(`https://api.test${reporte.prueba_ruta}`);
    expect(archivo.status).toBe(200);
    expect(archivo.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await archivo.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('no sirve claves fuera de reportes/', async () => {
    await sembrarBase(env.DB);
    await env.PRUEBAS.put('otra/clave.txt', 'no');
    const res = await SELF.fetch('https://api.test/admin/v1/pruebas/otra/clave.txt');
    expect(res.status).toBe(404);
  });
});

describe('cola y tableros', () => {
  it('lista borradores y reportes pendientes ordenados por popularidad', async () => {
    await sembrarBase(env.DB);
    const { varianteId } = await sembrarTramiteYVariante(env.DB, { popularidad: 5 });
    const borradorId = await insertarBorrador(env.DB, fichaEjemplo());
    const reporteId = await insertarReporte(env.DB, varianteId);

    const res = await SELF.fetch('https://api.test/admin/v1/cola');
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { items: { tipo: string; id: number; tramite_nombre: string }[]; total: number };
    expect(cuerpo.total).toBe(2);
    expect(cuerpo.items.map((i) => i.tipo).sort()).toEqual(['borrador', 'reporte']);
    expect(cuerpo.items.map((i) => i.id).sort((a, b) => a - b)).toEqual([borradorId, reporteId].sort((a, b) => a - b));
  });

  it('responde cobertura y salud', async () => {
    await sembrarBase(env.DB);
    await sembrarTramiteYVariante(env.DB);

    const cobertura = await SELF.fetch('https://api.test/admin/v1/cobertura');
    expect(cobertura.status).toBe(200);
    const datos = (await cobertura.json()) as { provincias: unknown[]; catalogo: unknown[]; cola: unknown[] };
    expect(datos.provincias).toHaveLength(1);

    const salud = await SELF.fetch('https://api.test/admin/v1/salud');
    expect(salud.status).toBe(200);
    expect(await salud.json()).toEqual({
      fuentes_caidas: [],
      cambios_sin_revisar: [],
      variantes_vencidas: [],
    });
  });

  it('devuelve el borrador con payload, diff y chequeos parseados', async () => {
    await sembrarBase(env.DB);
    const borradorId = await insertarBorrador(env.DB, fichaEjemplo(), { chequeos: ['Falta revisar el plazo'] });

    const res = await SELF.fetch(`https://api.test/admin/v1/borradores/${borradorId}`);
    expect(res.status).toBe(200);
    const borrador = (await res.json()) as {
      payload: { tramite: { slug: string } };
      diff: unknown;
      chequeos: string[];
    };
    expect(borrador.payload.tramite.slug).toBe('renovar-dni');
    expect(borrador.diff).toBeNull();
    expect(borrador.chequeos).toEqual(['Falta revisar el plazo']);
  });
});

describe('Cloudflare Access', () => {
  it('responde 401 sin el header cuando no está ADMIN_DEV', async () => {
    const res = await admin.request(
      '/cola',
      {},
      { ...env, ADMIN_DEV: '0' } as unknown as Env,
    );
    expect(res.status).toBe(401);
    const cuerpo = (await res.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe('no_autorizado');
  });

  it('deja pasar en desarrollo', async () => {
    const res = await admin.request('/cola', {}, { ...env, ADMIN_DEV: '1' } as unknown as Env);
    expect(res.status).toBe(200);
  });
});
