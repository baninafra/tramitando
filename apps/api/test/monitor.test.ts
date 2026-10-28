import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularHuella } from '../src/monitor/huella';
import { monitorearFuentes, type FetchMonitor } from '../src/monitor';
import { normalizarHtml } from '../src/monitor/normalizar';

const TABLAS = ['cola_trabajo', 'variante_fuentes', 'costos', 'variantes', 'fuentes', 'tramites'] as const;

beforeEach(async () => {
  for (const tabla of TABLAS) await env.DB.prepare(`DELETE FROM ${tabla}`).run();
});

async function insertarFuente(url: string, huella: string | null = null, ultimoChequeo: string | null = null): Promise<number> {
  const resultado = await env.DB.prepare('INSERT INTO fuentes (url, huella, ultimo_chequeo) VALUES (?, ?, ?)')
    .bind(url, huella, ultimoChequeo)
    .run();
  return Number(resultado.meta.last_row_id);
}

async function crearVariante(slug: string): Promise<number> {
  const tramite = await env.DB.prepare('INSERT INTO tramites (slug, nombre, nombre_busqueda, resumen) VALUES (?, ?, ?, ?)')
    .bind(slug, `Trámite ${slug}`, `Tramitar ${slug}`, 'Resumen de prueba')
    .run();
  const variante = await env.DB.prepare(
    `INSERT INTO variantes (tramite_id, jurisdiccion_id, contenido, verificado_en, proxima_revision)
     VALUES (?, 'nacion', '{}', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
  )
    .bind(Number(tramite.meta.last_row_id))
    .run();
  return Number(variante.meta.last_row_id);
}

async function asociarFuente(varianteId: number, fuenteId: number): Promise<void> {
  await env.DB.prepare("INSERT INTO variante_fuentes (variante_id, fuente_id, bloque) VALUES (?, ?, 'resumen')")
    .bind(varianteId, fuenteId)
    .run();
}

interface FuenteGuardada {
  huella: string | null;
  ultimo_chequeo: string | null;
  estado_http: number | null;
  cambio_detectado_en: string | null;
}

async function leerFuente(id: number): Promise<FuenteGuardada> {
  const fila = await env.DB.prepare(
    'SELECT huella, ultimo_chequeo, estado_http, cambio_detectado_en FROM fuentes WHERE id = ?',
  )
    .bind(id)
    .first<FuenteGuardada>();
  if (!fila) throw new Error(`No existe la fuente ${id}`);
  return fila;
}

async function contarCola(motivo: string, varianteId?: number): Promise<number> {
  const fila = varianteId
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM cola_trabajo WHERE motivo = ? AND variante_id = ? AND cerrado_en IS NULL')
        .bind(motivo, varianteId)
        .first<{ n: number }>()
    : await env.DB.prepare('SELECT COUNT(*) AS n FROM cola_trabajo WHERE motivo = ? AND cerrado_en IS NULL')
        .bind(motivo)
        .first<{ n: number }>();
  return fila?.n ?? 0;
}

function respuestaHtml(html: string): Response {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

describe('normalizarHtml', () => {
  it('ignora cambios de fecha de actualización, scripts, navegación y contadores de visitas', () => {
    const viejo = `<!doctype html><html><head><title>DNI</title>
      <script>var version = "vieja";</script></head>
      <body><nav>Inicio · Trámites</nav><header>Gobierno de la Nación</header>
      <main><h1>Documento Nacional de Identidad</h1>
      <p>Requisitos: &amp; turno previo.</p>
      <p>Última actualización: 01/02/2025</p></main>
      <footer><p>Visitas: 1234</p></footer></body></html>`;

    const nuevo = `<!doctype html><html><head><title>DNI</title>
      <script>var version = "nueva";</script></head>
      <body><nav>Menú distinto</nav><header>Otro encabezado</header>
      <main><h1>Documento Nacional de Identidad</h1>
      <p>Requisitos: &amp; turno previo.</p>
      <p>Última actualización: 05/09/2026</p></main>
      <footer><p>Visitas: 987654</p></footer></body></html>`;

    const texto = normalizarHtml(viejo);
    expect(texto).toBe(normalizarHtml(nuevo));
    expect(texto).toContain('Documento Nacional de Identidad');
    expect(texto).toContain('Requisitos: & turno previo.');
    expect(texto).not.toContain('versión');
    expect(texto).not.toContain('Inicio');
  });

  it('detecta un cambio real de contenido', () => {
    const antes = normalizarHtml('<p>El trámite es gratuito.</p>');
    const despues = normalizarHtml('<p>El trámite cuesta $ 500.</p>');
    expect(antes).not.toBe(despues);
  });
});

describe('calcularHuella', () => {
  it('devuelve sha-256 hexadecimal y es estable', async () => {
    const huella = await calcularHuella('hola');
    expect(huella).toBe('b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79');
    expect(await calcularHuella('hola')).toBe(huella);
    expect(await calcularHuella('hola!')).not.toBe(huella);
  });
});

describe('monitor de fuentes', () => {
  it('guarda la primera huella sin encolar trabajo', async () => {
    const fuenteId = await insertarFuente('https://www.argentina.gob.ar/tramite-test-a');
    const varianteId = await crearVariante('tramite-test-a');
    await asociarFuente(varianteId, fuenteId);

    const llamadas: string[] = [];
    await monitorearFuentes(env, {
      fetchImpl: async (url) => {
        llamadas.push(url);
        return respuestaHtml('<html><body><p>Contenido inicial</p></body></html>');
      },
    });

    expect(llamadas).toEqual(['https://www.argentina.gob.ar/tramite-test-a']);
    const fuente = await leerFuente(fuenteId);
    expect(fuente.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(fuente.cambio_detectado_en).toBeNull();
    expect(fuente.ultimo_chequeo).not.toBeNull();
    expect(fuente.estado_http).toBe(200);
    expect(await contarCola('cambio_fuente')).toBe(0);
  });

  it('detecta un cambio real y encola una revisión sin duplicados', async () => {
    const htmlViejo = '<html><body><p>El trámite es gratuito.</p></body></html>';
    const htmlNuevo = '<html><body><p>El trámite cuesta $ 500.</p></body></html>';
    const htmlTercero = '<html><body><p>El trámite cuesta $ 900.</p></body></html>';

    const fuenteId = await insertarFuente(
      'https://www.argentina.gob.ar/tramite-test-b',
      await calcularHuella(normalizarHtml(htmlViejo)),
      '2026-01-01T00:00:00Z',
    );
    const varianteId = await crearVariante('tramite-test-b');
    await asociarFuente(varianteId, fuenteId);

    await monitorearFuentes(env, { fetchImpl: async () => respuestaHtml(htmlNuevo) });

    const fuente = await leerFuente(fuenteId);
    expect(fuente.huella).toBe(await calcularHuella(normalizarHtml(htmlNuevo)));
    expect(fuente.cambio_detectado_en).not.toBeNull();
    expect(await contarCola('cambio_fuente', varianteId)).toBe(1);

    const item = await env.DB.prepare('SELECT prioridad FROM cola_trabajo WHERE variante_id = ? AND motivo = ?')
      .bind(varianteId, 'cambio_fuente')
      .first<{ prioridad: number }>();
    expect(item?.prioridad).toBe(20);

    // La misma respuesta no vuelve a encolar.
    await monitorearFuentes(env, { fetchImpl: async () => respuestaHtml(htmlNuevo) });
    expect(await contarCola('cambio_fuente', varianteId)).toBe(1);

    // Un cambio nuevo con el ítem todavía abierto tampoco duplica.
    await monitorearFuentes(env, { fetchImpl: async () => respuestaHtml(htmlTercero) });
    expect(await contarCola('cambio_fuente', varianteId)).toBe(1);
  });

  it('marca estado 0 cuando se agota el timeout', async () => {
    const fuenteId = await insertarFuente('https://www.argentina.gob.ar/tramite-test-timeout');

    const fetchQueNoResponde: FetchMonitor = (_url, init) =>
      new Promise<Response>((_resolver, rechazar) => {
        const signal = init?.signal;
        if (!signal) {
          rechazar(new Error('La petición no tiene signal'));
          return;
        }
        if (signal.aborted) {
          rechazar(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => rechazar(signal.reason), { once: true });
      });

    await monitorearFuentes(env, { fetchImpl: fetchQueNoResponde, timeoutMs: 20 });

    const fuente = await leerFuente(fuenteId);
    expect(fuente.estado_http).toBe(0);
    expect(fuente.ultimo_chequeo).not.toBeNull();
    expect(fuente.huella).toBeNull();
    expect(fuente.cambio_detectado_en).toBeNull();
  });

  it('saltea las URLs que no son oficiales', async () => {
    const fuenteId = await insertarFuente('https://example.com/tramite-no-oficial');
    let llamadas = 0;

    await monitorearFuentes(env, {
      fetchImpl: async () => {
        llamadas += 1;
        return respuestaHtml('<p>No debería pedirse</p>');
      },
    });

    expect(llamadas).toBe(0);
    const fuente = await leerFuente(fuenteId);
    expect(fuente.estado_http).toBeNull();
    expect(fuente.ultimo_chequeo).toBeNull();
  });
});
