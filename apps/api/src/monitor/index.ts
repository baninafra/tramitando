/**
 * Monitor de fuentes oficiales.
 *
 * Cada corrida revisa las 300 fuentes con `ultimo_chequeo` más viejo (las nunca revisadas van
 * primero), de a 10 en paralelo y con un timeout de 15 s. Si el texto normalizado cambió respecto
 * de la huella guardada, marca la fuente y encola una revisión por cada variante que la usa.
 */
import { esUrlOficial } from '@tramitando/shared';
import { encolarSiFalta } from '../cron/cola';
import type { Env } from '../env';
import { calcularHuella } from './huella';
import { normalizarHtml } from './normalizar';

export type FetchMonitor = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesMonitor {
  fetchImpl?: FetchMonitor;
  timeoutMs?: number;
  ahora?: () => Date;
  limite?: number;
  concurrencia?: number;
}

interface FuenteFila {
  id: number;
  url: string;
  huella: string | null;
}

const LIMITE_POR_CORRIDA = 300;
const CONCURRENCIA = 10;
const TIMEOUT_MS = 15_000;

function partirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

async function revisarFuente(env: Env, fuente: FuenteFila, opciones: Required<OpcionesMonitor>): Promise<void> {
  if (!esUrlOficial(fuente.url)) return;

  const chequeadoEn = opciones.ahora().toISOString();
  let estadoHttp = 0;
  let html: string | null = null;

  try {
    const respuesta = await opciones.fetchImpl(fuente.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(opciones.timeoutMs),
      headers: { 'user-agent': 'TramitandoMonitor/1.0 (+https://tramitando.ar)' },
    });
    estadoHttp = respuesta.status;
    if (respuesta.ok) html = await respuesta.text();
  } catch {
    estadoHttp = 0;
  }

  if (html === null) {
    await env.DB.prepare('UPDATE fuentes SET ultimo_chequeo = ?, estado_http = ? WHERE id = ?')
      .bind(chequeadoEn, estadoHttp, fuente.id)
      .run();
    return;
  }

  const huella = await calcularHuella(normalizarHtml(html));

  if (fuente.huella === huella) {
    await env.DB.prepare('UPDATE fuentes SET ultimo_chequeo = ?, estado_http = ? WHERE id = ?')
      .bind(chequeadoEn, estadoHttp, fuente.id)
      .run();
    return;
  }

  if (fuente.huella === null) {
    // Primera lectura: solo se guarda la huella, no hay nada con qué comparar.
    await env.DB.prepare('UPDATE fuentes SET huella = ?, ultimo_chequeo = ?, estado_http = ? WHERE id = ?')
      .bind(huella, chequeadoEn, estadoHttp, fuente.id)
      .run();
    return;
  }

  await env.DB.prepare(
    'UPDATE fuentes SET huella = ?, ultimo_chequeo = ?, estado_http = ?, cambio_detectado_en = ? WHERE id = ?',
  )
    .bind(huella, chequeadoEn, estadoHttp, chequeadoEn, fuente.id)
    .run();

  const variantes = await env.DB.prepare('SELECT DISTINCT variante_id FROM variante_fuentes WHERE fuente_id = ?')
    .bind(fuente.id)
    .all<{ variante_id: number }>();

  for (const variante of variantes.results) {
    await encolarSiFalta(env.DB, variante.variante_id, 'cambio_fuente', 20);
  }
}

/** Revisa las fuentes pendientes. Devuelve cuántas se procesaron (sin contar las salteadas). */
export async function monitorearFuentes(env: Env, opciones: OpcionesMonitor = {}): Promise<number> {
  const resueltas: Required<OpcionesMonitor> = {
    fetchImpl: opciones.fetchImpl ?? ((url, init) => globalThis.fetch(url, init)),
    timeoutMs: opciones.timeoutMs ?? TIMEOUT_MS,
    ahora: opciones.ahora ?? (() => new Date()),
    limite: opciones.limite ?? LIMITE_POR_CORRIDA,
    concurrencia: opciones.concurrencia ?? CONCURRENCIA,
  };

  const { results } = await env.DB.prepare(
    `SELECT id, url, huella FROM fuentes
     ORDER BY (ultimo_chequeo IS NOT NULL), ultimo_chequeo ASC, id ASC
     LIMIT ?`,
  )
    .bind(resueltas.limite)
    .all<FuenteFila>();

  for (const lote of partirEnLotes(results, resueltas.concurrencia)) {
    await Promise.all(lote.map((fuente) => revisarFuente(env, fuente, resueltas)));
  }

  return results.length;
}
