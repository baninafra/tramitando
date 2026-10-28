import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTENIDO_EJEMPLO,
  borradorEjemplo,
  crearItemCola,
  crearTema,
  limpiarBase,
  sembrarFichaPublicada,
  sembrarJurisdicciones,
} from './fixtures/ingest';

const TOKEN = 'token-de-prueba';

function pedir(ruta: string, init: RequestInit = {}) {
  return SELF.fetch(`https://api.test/ingest/v1${ruta}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}

function postJson(ruta: string, cuerpo: unknown) {
  return pedir(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

function entrada(url: string, jurisdiccionId = 'nacion', nombre = 'Trámite de prueba') {
  return {
    url,
    nombre_oficial: nombre,
    jurisdiccion_id: jurisdiccionId,
    organismo: 'Organismo de prueba',
    temas_sugeridos: ['documentos'],
    portal: 'portal-de-prueba',
  };
}

async function idDeCola(): Promise<number> {
  const fila = await env.DB.prepare('SELECT id FROM cola_trabajo ORDER BY id DESC LIMIT 1').first<{ id: number }>();
  if (!fila) throw new Error('No hay ítems en la cola');
  return fila.id;
}

describe('/ingest/v1', () => {
  beforeEach(async () => {
    await limpiarBase();
    await sembrarJurisdicciones();
    await crearTema('documentos', 'Documentos');
  });

  it('rechaza pedidos sin token o con token incorrecto', async () => {
    const sinToken = await SELF.fetch('https://api.test/ingest/v1/trabajo');
    expect(sinToken.status).toBe(401);

    const tokenMalo = await SELF.fetch('https://api.test/ingest/v1/trabajo', {
      headers: { authorization: 'Bearer token-incorrecto' },
    });
    expect(tokenMalo.status).toBe(401);
  });

  it('carga el catálogo, ignora repetidas y reporta inválidas sin frenar el resto', async () => {
    const validaNacion = entrada('https://www.argentina.gob.ar/tramites/renovacion-dni');
    const validaProvincia = entrada('https://www.gba.gob.ar/tramites/dni', 'prov-06', 'DNI en la provincia');

    const res = await postJson('/catalogo', {
      entradas: [validaNacion, validaNacion, entrada('https://ejemplo.com/no-oficial'), validaProvincia],
    });
    expect(res.status).toBe(200);

    const cuerpo = (await res.json()) as {
      nuevas: number;
      repetidas: number;
      invalidas: { indice: number; error: string }[];
    };
    expect(cuerpo.nuevas).toBe(2);
    expect(cuerpo.repetidas).toBe(1);
    expect(cuerpo.invalidas).toHaveLength(1);
    expect(cuerpo.invalidas[0]?.indice).toBe(2);
    expect(cuerpo.invalidas[0]?.error.length).toBeGreaterThan(0);

    const catalogo = await env.DB.prepare('SELECT url, prioridad FROM catalogo ORDER BY prioridad').all<{
      url: string;
      prioridad: number;
    }>();
    expect(catalogo.results).toEqual([
      { url: validaNacion.url, prioridad: 10 },
      { url: validaProvincia.url, prioridad: 100 },
    ]);

    const cola = await env.DB.prepare('SELECT motivo, prioridad, catalogo_id FROM cola_trabajo ORDER BY prioridad').all<{
      motivo: string;
      prioridad: number;
      catalogo_id: number;
    }>();
    expect(cola.results.map((fila) => fila.motivo)).toEqual(['nueva', 'nueva']);
    expect(cola.results.map((fila) => fila.prioridad)).toEqual([10, 100]);
  });

  it('rechaza más de 500 entradas de catálogo', async () => {
    const res = await postJson('/catalogo', { entradas: new Array(501).fill(entrada('https://www.argentina.gob.ar/x')) });
    expect(res.status).toBe(400);
  });

  it('entrega trabajo por prioridad y no repite ítems entre dos pedidos', async () => {
    await postJson('/catalogo', {
      entradas: [
        entrada('https://www.argentina.gob.ar/tramites/renovacion-dni'),
        entrada('https://www.gba.gob.ar/tramites/dni', 'prov-06'),
      ],
    });

    const primero = await pedir('/trabajo?limite=10');
    expect(primero.status).toBe(200);
    const items = (await primero.json()) as {
      cola_trabajo_id: number;
      motivo: string;
      catalogo: { jurisdiccion_id: string; url: string } | null;
      variante: unknown | null;
    }[];

    expect(items).toHaveLength(2);
    expect(items[0]?.motivo).toBe('nueva');
    expect(items[0]?.catalogo?.jurisdiccion_id).toBe('nacion');
    expect(items[0]?.variante).toBeNull();
    expect(items[1]?.catalogo?.jurisdiccion_id).toBe('prov-06');

    const tomados = await env.DB.prepare('SELECT COUNT(*) AS cantidad FROM cola_trabajo WHERE tomado_en IS NOT NULL').first<{
      cantidad: number;
    }>();
    expect(tomados?.cantidad).toBe(2);

    const segundo = await pedir('/trabajo?limite=10');
    expect(segundo.status).toBe(200);
    expect(await segundo.json()).toEqual([]);
  });

  it('vuelve a ofrecer ítems tomados hace más de 6 horas', async () => {
    await postJson('/catalogo', { entradas: [entrada('https://www.argentina.gob.ar/tramites/renovacion-dni')] });
    await pedir('/trabajo?limite=10');

    const viejo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE cola_trabajo SET tomado_en = ?').bind(viejo).run();

    const res = await pedir('/trabajo?limite=10');
    const items = (await res.json()) as unknown[];
    expect(items).toHaveLength(1);
  });

  it('crea una ficha nueva desde un borrador y cierra el ítem de la cola', async () => {
    await postJson('/catalogo', { entradas: [entrada('https://www.argentina.gob.ar/tramites/renovacion-dni')] });
    const colaId = await idDeCola();

    const res = await postJson('/borradores', { cola_trabajo_id: colaId, borrador: borradorEjemplo() });
    expect(res.status).toBe(201);

    const cuerpo = (await res.json()) as {
      id: number;
      tipo: string;
      diff: unknown;
      chequeos: string[];
      temasNuevos: number[];
    };
    expect(cuerpo.id).toBeGreaterThan(0);
    expect(cuerpo.tipo).toBe('ficha_nueva');
    expect(cuerpo.diff).toBeNull();
    expect(cuerpo.chequeos).toEqual([]);

    const borrador = await env.DB.prepare(
      "SELECT tipo, origen, variante_id, payload, diff, estado FROM borradores WHERE id = ?",
    )
      .bind(cuerpo.id)
      .first<{ tipo: string; origen: string; variante_id: number | null; payload: string; diff: string | null; estado: string }>();
    expect(borrador).toMatchObject({ tipo: 'ficha_nueva', origen: 'ia', variante_id: null, diff: null, estado: 'pendiente' });
    expect(JSON.parse(borrador?.payload ?? '{}').tramite.slug).toBe('renovacion-dni');

    const catalogo = await env.DB.prepare('SELECT estado FROM catalogo').first<{ estado: string }>();
    expect(catalogo?.estado).toBe('en_revision');

    const cola = await env.DB.prepare('SELECT cerrado_en FROM cola_trabajo WHERE id = ?')
      .bind(colaId)
      .first<{ cerrado_en: string | null }>();
    expect(cola?.cerrado_en).not.toBeNull();
  });

  it('detecta una actualización y guarda el diff contra la variante publicada', async () => {
    const ficha = await sembrarFichaPublicada();
    const colaId = await crearItemCola({ varianteId: ficha.varianteId, motivo: 'vencida', prioridad: 50 });

    const borrador = borradorEjemplo({
      contenido: { ...CONTENIDO_EJEMPLO, plazo: '30 días hábiles' },
      costos: [
        {
          modalidad: 'Trámite normal',
          gratis: false,
          monto_centavos: 1000,
          vigente_desde: '2026-02-01',
          nota: 'Arancel actualizado',
          fuente_url: 'https://www.argentina.gob.ar/tramites/renovacion-dni',
        },
      ],
    });

    const res = await postJson('/borradores', { cola_trabajo_id: colaId, borrador });
    expect(res.status).toBe(201);

    const cuerpo = (await res.json()) as {
      tipo: string;
      diff: Record<string, { antes: Record<string, unknown>; despues: Record<string, unknown> }>;
    };
    expect(cuerpo.tipo).toBe('actualizacion');
    expect(cuerpo.diff.contenido?.antes.plazo).toBe('15 días hábiles');
    expect(cuerpo.diff.contenido?.despues.plazo).toBe('30 días hábiles');
    expect(cuerpo.diff.costos).toBeDefined();
    expect(cuerpo.diff.tramite).toBeUndefined();
    expect(cuerpo.diff.fuentes).toBeUndefined();

    const fila = await env.DB.prepare('SELECT tipo, variante_id, diff FROM borradores ORDER BY id DESC LIMIT 1').first<{
      tipo: string;
      variante_id: number | null;
      diff: string | null;
    }>();
    expect(fila?.tipo).toBe('actualizacion');
    expect(fila?.variante_id).toBe(ficha.varianteId);
    expect(fila?.diff).toContain('30 días hábiles');
  });

  it('crea un tema propuesto y su borrador tema_nuevo', async () => {
    await postJson('/catalogo', { entradas: [entrada('https://www.argentina.gob.ar/tramites/renovacion-dni')] });
    const colaId = await idDeCola();

    const base = borradorEjemplo();
    const borrador = {
      ...base,
      tramite: {
        ...base.tramite,
        temas_propuestos: [{ slug: 'tramites-online', nombre: 'Trámites online', padre: null }],
      },
    };

    const res = await postJson('/borradores', { cola_trabajo_id: colaId, borrador });
    expect(res.status).toBe(201);

    const cuerpo = (await res.json()) as { temasNuevos: number[] };
    expect(cuerpo.temasNuevos).toHaveLength(1);

    const tema = await env.DB.prepare('SELECT nombre, estado, padre_id FROM temas WHERE slug = ?')
      .bind('tramites-online')
      .first<{ nombre: string; estado: string; padre_id: number | null }>();
    expect(tema).toEqual({ nombre: 'Trámites online', estado: 'propuesto', padre_id: null });

    const temaBorrador = await env.DB.prepare("SELECT payload FROM borradores WHERE tipo = 'tema_nuevo'").first<{
      payload: string;
    }>();
    expect(temaBorrador).not.toBeNull();
    expect(JSON.parse(temaBorrador?.payload ?? '{}')).toMatchObject({
      slug: 'tramites-online',
      nombre: 'Trámites online',
      padre: null,
    });
  });

  it('no duplica un tema propuesto que ya existe', async () => {
    await postJson('/catalogo', { entradas: [entrada('https://www.argentina.gob.ar/tramites/renovacion-dni')] });
    const colaId = await idDeCola();
    await crearTema('tramites-online', 'Trámites online');

    const base = borradorEjemplo();
    const borrador = {
      ...base,
      tramite: { ...base.tramite, temas_propuestos: [{ slug: 'tramites-online', nombre: 'Trámites online', padre: null }] },
    };

    const res = await postJson('/borradores', { cola_trabajo_id: colaId, borrador });
    expect(res.status).toBe(201);

    const temas = await env.DB.prepare("SELECT COUNT(*) AS cantidad FROM temas WHERE slug = 'tramites-online'").first<{
      cantidad: number;
    }>();
    expect(temas?.cantidad).toBe(1);
    const borradoresTema = await env.DB.prepare("SELECT COUNT(*) AS cantidad FROM borradores WHERE tipo = 'tema_nuevo'").first<{
      cantidad: number;
    }>();
    expect(borradoresTema?.cantidad).toBe(1);
  });

  it('rechaza un borrador inválido con 422 y los errores', async () => {
    await postJson('/catalogo', { entradas: [entrada('https://www.argentina.gob.ar/tramites/renovacion-dni')] });
    const colaId = await idDeCola();

    const res = await postJson('/borradores', { cola_trabajo_id: colaId, borrador: { tramite: { slug: 'MAL SLUG' } } });
    expect(res.status).toBe(422);
    const cuerpo = (await res.json()) as { error: { codigo: string; detalles: unknown[] } };
    expect(cuerpo.error.codigo).toBe('borrador_invalido');
    expect(cuerpo.error.detalles.length).toBeGreaterThan(0);
  });

  it('registra una verificación sin cambios y renueva la revisión', async () => {
    const ficha = await sembrarFichaPublicada({
      proximaRevision: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      verificacion: 'revisar',
    });
    const colaId = await crearItemCola({ varianteId: ficha.varianteId, motivo: 'vencida', prioridad: 50 });

    const res = await postJson('/sin-cambios', {
      cola_trabajo_id: colaId,
      variante_id: ficha.varianteId,
      notas: 'La fuente sigue igual.',
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: true });

    const verificacion = await env.DB.prepare('SELECT autor, resultado, notas FROM verificaciones WHERE variante_id = ?')
      .bind(ficha.varianteId)
      .first<{ autor: string; resultado: string; notas: string | null }>();
    expect(verificacion).toEqual({ autor: 'ia', resultado: 'sin_cambios', notas: 'La fuente sigue igual.' });

    const variante = await env.DB.prepare('SELECT verificacion, verificado_en, proxima_revision FROM variantes WHERE id = ?')
      .bind(ficha.varianteId)
      .first<{ verificacion: string; verificado_en: string; proxima_revision: string }>();
    expect(variante?.verificacion).toBe('verificado');
    expect(new Date(variante?.proxima_revision ?? 0).getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 60 * 60 * 1000);

    const cola = await env.DB.prepare('SELECT cerrado_en FROM cola_trabajo WHERE id = ?')
      .bind(colaId)
      .first<{ cerrado_en: string | null }>();
    expect(cola?.cerrado_en).not.toBeNull();
  });
});

describe('POST /ingest/v1/descartar', () => {
  beforeEach(async () => {
    await limpiarBase();
    await sembrarJurisdicciones();
    await crearTema('documentos', 'Documentos');
  });

  async function crearCatalogo(url: string, extra: { tramiteId?: number; varianteId?: number } = {}): Promise<number> {
    const r = await env.DB.prepare(
      `INSERT INTO catalogo (url, nombre_oficial, jurisdiccion_id, portal, estado, tramite_id, variante_id)
       VALUES (?, 'Una noticia', 'nacion', 'portal', ?, ?, ?)`,
    )
      .bind(url, extra.varianteId ? 'publicado' : 'pendiente', extra.tramiteId ?? null, extra.varianteId ?? null)
      .run();
    return r.meta.last_row_id;
  }

  it('cierra el ítem de la cola y marca la entrada como descartada', async () => {
    const catalogoId = await crearCatalogo('https://www.argentina.gob.ar/noticia-1');
    const colaId = await crearItemCola({ catalogoId });
    const r = await postJson('/descartar', { cola_trabajo_id: colaId });
    expect(r.status).toBe(200);
    const cat = await env.DB.prepare('SELECT estado FROM catalogo WHERE id = ?').bind(catalogoId).first<{ estado: string }>();
    const cola = await env.DB.prepare('SELECT cerrado_en FROM cola_trabajo WHERE id = ?').bind(colaId).first<{ cerrado_en: string | null }>();
    expect(cat?.estado).toBe('descartado');
    expect(cola?.cerrado_en).not.toBeNull();
  });

  it('archiva la variante y el trámite si ya estaban publicados', async () => {
    const ficha = await sembrarFichaPublicada();
    const catalogoId = await crearCatalogo('https://www.argentina.gob.ar/noticia-2', { tramiteId: ficha.tramiteId, varianteId: ficha.varianteId });
    const r = await postJson('/descartar', { catalogo_id: catalogoId });
    expect(r.status).toBe(200);
    const variante = await env.DB.prepare('SELECT estado FROM variantes WHERE id = ?').bind(ficha.varianteId).first<{ estado: string }>();
    const tramite = await env.DB.prepare('SELECT estado FROM tramites WHERE id = ?').bind(ficha.tramiteId).first<{ estado: string }>();
    expect(variante?.estado).toBe('archivada');
    expect(tramite?.estado).toBe('archivado');
  });

  it('pide un ítem o una entrada y avisa si no existe', async () => {
    expect((await postJson('/descartar', {})).status).toBe(400);
    expect((await postJson('/descartar', { catalogo_id: 999 })).status).toBe(404);
    expect((await postJson('/descartar', { cola_trabajo_id: 999 })).status).toBe(404);
  });
});
