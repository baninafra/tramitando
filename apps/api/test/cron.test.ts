import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRON_MONITOR_FUENTES, CRON_VENCIMIENTOS, tareasProgramadas } from '../src/cron';
import { procesarVencimientos } from '../src/cron/vencimientos';

const TABLAS = ['cola_trabajo', 'variante_fuentes', 'costos', 'variantes', 'fuentes', 'tramites'] as const;

beforeEach(async () => {
  for (const tabla of TABLAS) await env.DB.prepare(`DELETE FROM ${tabla}`).run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function contexto(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function evento(cron: string): ScheduledController {
  return { cron } as unknown as ScheduledController;
}

interface OpcionesVariante {
  proximaRevision?: string;
  estado?: 'publicada' | 'archivada';
  verificacion?: 'verificado' | 'revisar';
}

async function crearVariante(slug: string, opciones: OpcionesVariante = {}): Promise<number> {
  const tramite = await env.DB.prepare('INSERT INTO tramites (slug, nombre, nombre_busqueda, resumen) VALUES (?, ?, ?, ?)')
    .bind(slug, `Trámite ${slug}`, `Tramitar ${slug}`, 'Resumen de prueba')
    .run();
  const variante = await env.DB.prepare(
    `INSERT INTO variantes (tramite_id, jurisdiccion_id, contenido, verificado_en, proxima_revision, estado, verificacion)
     VALUES (?, 'nacion', '{}', '2026-01-01T00:00:00Z', ?, ?, ?)`,
  )
    .bind(
      Number(tramite.meta.last_row_id),
      opciones.proximaRevision ?? '2099-01-01T00:00:00Z',
      opciones.estado ?? 'publicada',
      opciones.verificacion ?? 'verificado',
    )
    .run();
  return Number(variante.meta.last_row_id);
}

async function insertarCosto(varianteId: number): Promise<void> {
  await env.DB.prepare("INSERT INTO costos (variante_id, modalidad, monto_centavos, gratis) VALUES (?, 'Normal', 100000, 0)")
    .bind(varianteId)
    .run();
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

async function verificacionDe(varianteId: number): Promise<string | undefined> {
  const fila = await env.DB.prepare('SELECT verificacion FROM variantes WHERE id = ?').bind(varianteId).first<{ verificacion: string }>();
  return fila?.verificacion;
}

describe('migración de jurisdicciones', () => {
  it('carga la nación, 24 provincias, más de 1000 municipios y las 15 comunas de CABA', async () => {
    const nacion = await env.DB.prepare("SELECT COUNT(*) AS n FROM jurisdicciones WHERE nivel = 'nacion'").first<{ n: number }>();
    const provincias = await env.DB.prepare("SELECT COUNT(*) AS n FROM jurisdicciones WHERE nivel = 'provincia'").first<{ n: number }>();
    const municipios = await env.DB.prepare("SELECT COUNT(*) AS n FROM jurisdicciones WHERE nivel = 'municipio'").first<{ n: number }>();
    const comunas = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jurisdicciones WHERE nivel = 'municipio' AND padre_id = 'prov-02'",
    ).first<{ n: number }>();

    expect(nacion?.n).toBe(1);
    expect(provincias?.n).toBe(24);
    expect(municipios?.n).toBeGreaterThan(1000);
    expect(comunas?.n).toBe(15);
  });
});

describe('tareas programadas', () => {
  it('despacha el monitor de fuentes por controller.cron', async () => {
    const fuente = await env.DB.prepare('INSERT INTO fuentes (url) VALUES (?)')
      .bind('https://www.argentina.gob.ar/tramite-dispatch')
      .run();
    vi.stubGlobal('fetch', async () => new Response('<p>Contenido</p>', { status: 200 }));

    await tareasProgramadas(evento(CRON_MONITOR_FUENTES), env, contexto());

    const fila = await env.DB.prepare('SELECT ultimo_chequeo, estado_http FROM fuentes WHERE id = ?')
      .bind(Number(fuente.meta.last_row_id))
      .first<{ ultimo_chequeo: string | null; estado_http: number | null }>();
    expect(fila?.ultimo_chequeo).not.toBeNull();
    expect(fila?.estado_http).toBe(200);
  });

  it('despacha los vencimientos por controller.cron', async () => {
    const varianteId = await crearVariante('vencida-dispatch', { proximaRevision: '2000-01-01T00:00:00Z' });

    await tareasProgramadas(evento(CRON_VENCIMIENTOS), env, contexto());

    expect(await verificacionDe(varianteId)).toBe('revisar');
    expect(await contarCola('vencida', varianteId)).toBe(1);
  });

  it('no hace nada con un cron desconocido', async () => {
    await tareasProgramadas(evento('0 0 1 1 *'), env, contexto());
    expect(await contarCola('vencida')).toBe(0);
  });
});

describe('vencimientos', () => {
  it('pasa a revisar las variantes publicadas cuyo plazo venció y encola sin duplicar', async () => {
    const vencida = await crearVariante('vencida-1', { proximaRevision: '2000-01-01T00:00:00Z' });
    const alDia = await crearVariante('al-dia-1', { proximaRevision: '2099-01-01T00:00:00Z' });
    const archivada = await crearVariante('archivada-1', { proximaRevision: '2000-01-01T00:00:00Z', estado: 'archivada' });

    const resultado = await procesarVencimientos(env, new Date('2026-04-15T05:00:00Z'));
    expect(resultado.vencidas).toBe(1);

    expect(await verificacionDe(vencida)).toBe('revisar');
    expect(await verificacionDe(alDia)).toBe('verificado');
    expect(await verificacionDe(archivada)).toBe('verificado');

    expect(await contarCola('vencida', vencida)).toBe(1);
    expect(await contarCola('vencida', alDia)).toBe(0);
    expect(await contarCola('vencida', archivada)).toBe(0);

    const prioridad = await env.DB.prepare('SELECT prioridad FROM cola_trabajo WHERE variante_id = ? AND motivo = ?')
      .bind(vencida, 'vencida')
      .first<{ prioridad: number }>();
    expect(prioridad?.prioridad).toBe(50);

    // Segunda corrida: no duplica el ítem abierto.
    await procesarVencimientos(env, new Date('2026-04-15T06:00:00Z'));
    expect(await contarCola('vencida', vencida)).toBe(1);
  });

  it('encola costos solo el día 1 y solo para variantes publicadas con costos', async () => {
    const conCosto = await crearVariante('con-costo-1');
    const sinCosto = await crearVariante('sin-costo-1');
    await insertarCosto(conCosto);

    const otroDia = await procesarVencimientos(env, new Date('2026-04-15T05:00:00Z'));
    expect(otroDia.costos).toBe(0);
    expect(await contarCola('costos', conCosto)).toBe(0);

    const diaPrimero = await procesarVencimientos(env, new Date('2026-04-01T05:00:00Z'));
    expect(diaPrimero.costos).toBe(1);
    expect(await contarCola('costos', conCosto)).toBe(1);
    expect(await contarCola('costos', sinCosto)).toBe(0);

    const prioridad = await env.DB.prepare('SELECT prioridad FROM cola_trabajo WHERE variante_id = ? AND motivo = ?')
      .bind(conCosto, 'costos')
      .first<{ prioridad: number }>();
    expect(prioridad?.prioridad).toBe(60);

    // Segunda corrida del día 1: no duplica.
    await procesarVencimientos(env, new Date('2026-04-01T06:00:00Z'));
    expect(await contarCola('costos', conCosto)).toBe(1);
  });
});
