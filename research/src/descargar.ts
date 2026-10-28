import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { esFuenteAceptada } from './confirmados.js';
import type { OpcionesRender, ResultadoRender } from './navegador.js';
import { rutaDatos } from './rutas.js';

export const USER_AGENT = 'TramitandoBot/0.1 (investigacion de tramites publicos)';

export type TipoContenido = 'html' | 'json' | 'texto' | 'pdf' | 'otro';

export interface Descarga {
  url: string;
  url_final: string;
  status: number;
  content_type: string;
  fecha: string;
  cuerpo: string;
  tipo: TipoContenido;
  desde_cache: boolean;
}

export type RenderizadorFn = (
  url: string,
  opciones?: OpcionesRender,
) => Promise<ResultadoRender>;

export interface OpcionesDescarga {
  /** Inyectable en tests. Por defecto `globalThis.fetch`. */
  fetch?: typeof fetch;
  dirCache?: string;
  sinCache?: boolean;
  cacheDias?: number;
  intervaloHostMs?: number;
  timeoutMs?: number;
  reintentos?: number;
  esperaMs?: number;
  maxRedirecciones?: number;
  ahora?: () => number;
  /** Caché en memoria de robots.txt, para tests o ejecuciones aisladas. */
  robotsCache?: Map<string, string | null>;
  /** Pide la página con el navegador (JavaScript ya ejecutado) en vez de `fetch`. */
  renderizar?: boolean;
  /** Inyectable en tests. Por defecto el navegador de `navegador.ts`. */
  renderizador?: RenderizadorFn;
}

const MAX_REDIRECCIONES = 5;
const TIMEOUT_MS = 20_000;
const REINTENTOS = 2;
const ESPERA_MS = 500;
const INTERVALO_HOST_MS = 1000;
const CACHE_DIAS = 7;

class Semaforo {
  private activos = 0;
  private cola: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.activos < this.max) {
      this.activos += 1;
      return;
    }
    await new Promise<void>((resolver) => this.cola.push(resolver));
    this.activos += 1;
  }

  release(): void {
    this.activos -= 1;
    const siguiente = this.cola.shift();
    if (siguiente) siguiente();
  }
}

const semaforoRed = new Semaforo(6);
const ultimaVisitaPorHost = new Map<string, number>();
const colaPorHost = new Map<string, Promise<void>>();
const robotsEnMemoria = new Map<string, string | null>();

function dormir(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolver) => setTimeout(resolver, ms));
}

export function tipoDeContenido(contentType: string): TipoContenido {
  const base = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (base === 'application/pdf') return 'pdf';
  if (base === 'text/html' || base === 'application/xhtml+xml') return 'html';
  if (base === 'application/json' || base.endsWith('+json')) return 'json';
  if (base === 'application/xml' || base.endsWith('+xml')) return 'texto';
  if (base.startsWith('text/')) return 'texto';
  return 'otro';
}

/** Heurística para servidores que no mandan Content-Type. */
function olerContenido(cuerpo: string): TipoContenido {
  const inicio = cuerpo.trimStart().slice(0, 200).toLowerCase();
  if (inicio.startsWith('<!doctype html') || inicio.startsWith('<html') || inicio.startsWith('<')) {
    return 'html';
  }
  if (inicio.startsWith('{') || inicio.startsWith('[')) return 'json';
  if (inicio.length > 0) return 'texto';
  return 'otro';
}

export function urlDeCache(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/** La versión renderizada se guarda aparte para no mezclarla con el HTML crudo. */
function claveCache(url: string, render: boolean): string {
  return urlDeCache(render ? `${url}#render` : url);
}

/**
 * Reglas de robots.txt relevantes para nuestro User-Agent. Parser mínimo: grupos de
 * User-agent con Allow/Disallow; gana la regla más específica y, a igual longitud, Allow.
 */
export function robotsPermite(robots: string, ruta: string): boolean {
  interface Grupo {
    agentes: string[];
    reglas: { permitir: boolean; ruta: string }[];
  }
  const grupos: Grupo[] = [];
  let actual: Grupo = { agentes: [], reglas: [] };

  for (const lineaCruda of robots.split(/\r?\n/)) {
    const linea = lineaCruda.replace(/#.*$/, '').trim();
    if (!linea) continue;
    const idx = linea.indexOf(':');
    if (idx < 0) continue;
    const campo = linea.slice(0, idx).trim().toLowerCase();
    const valor = linea.slice(idx + 1).trim();
    if (campo === 'user-agent') {
      if (actual.reglas.length > 0) {
        grupos.push(actual);
        actual = { agentes: [], reglas: [] };
      }
      actual.agentes.push(valor.toLowerCase());
    } else if (campo === 'allow' || campo === 'disallow') {
      if (valor === '') continue;
      actual.reglas.push({ permitir: campo === 'allow', ruta: valor });
    }
  }
  if (actual.agentes.length > 0 || actual.reglas.length > 0) grupos.push(actual);

  const agentesBuscados = ['tramitandobot', '*'];
  const reglas = grupos
    .filter((g) => g.agentes.some((a) => agentesBuscados.includes(a)))
    .flatMap((g) => g.reglas);

  let mejor: { permitir: boolean; largo: number } | undefined;
  for (const regla of reglas) {
    if (!ruta.startsWith(regla.ruta)) continue;
    const largo = regla.ruta.length;
    if (!mejor || largo > mejor.largo || (largo === mejor.largo && regla.permitir)) {
      mejor = { permitir: regla.permitir, largo };
    }
  }
  return mejor ? mejor.permitir : true;
}

export async function esperarTurnoHost(host: string, intervaloMs: number): Promise<void> {
  if (intervaloMs <= 0) return;
  const anterior = colaPorHost.get(host) ?? Promise.resolve();
  const turno = anterior.then(async () => {
    const ultima = ultimaVisitaPorHost.get(host);
    if (ultima !== undefined) {
      const espera = ultima + intervaloMs - Date.now();
      if (espera > 0) await dormir(espera);
    }
    ultimaVisitaPorHost.set(host, Date.now());
  });
  colaPorHost.set(host, turno);
  await turno;
}

function validarOficial(url: string): void {
  if (!esFuenteAceptada(url)) {
    throw new Error(`URL no oficial: ${url}`);
  }
}

type ConfigRed = Required<Pick<OpcionesDescarga, 'fetch' | 'timeoutMs' | 'esperaMs' | 'reintentos'>> & {
  intervaloHostMs: number;
};

async function leerRobots(
  host: string,
  opciones: ConfigRed,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(host)) return cache.get(host) ?? null;
  const robotsUrl = `https://${host}/robots.txt`;
  try {
    const res = await pedirRed(robotsUrl, opciones, true);
    const texto = res.ok ? await res.text() : null;
    cache.set(host, texto);
    return texto;
  } catch {
    cache.set(host, null);
    return null;
  }
}

async function comprobarRobots(
  url: string,
  config: ConfigRed,
  cache: Map<string, string | null>,
): Promise<void> {
  validarOficial(url);
  const u = new URL(url);
  const robots = await leerRobots(u.hostname.toLowerCase(), config, cache);
  if (robots === null) return;
  if (!robotsPermite(robots, u.pathname + u.search)) {
    throw new Error(`robots.txt no permite descargar ${url}`);
  }
}

async function pedirRed(
  url: string,
  opciones: {
    fetch: typeof fetch;
    timeoutMs: number;
    esperaMs: number;
    reintentos: number;
    intervaloHostMs: number;
  },
  sinReintentos = false,
): Promise<Response> {
  const host = new URL(url).hostname.toLowerCase();
  const maxIntentos = sinReintentos ? 1 : opciones.reintentos + 1;
  let ultimoError: unknown;

  for (let intento = 0; intento < maxIntentos; intento += 1) {
    if (intento > 0) await dormir(opciones.esperaMs * intento);
    await esperarTurnoHost(host, opciones.intervaloHostMs);
    await semaforoRed.acquire();
    try {
      const res = await opciones.fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml,application/json,text/plain;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(opciones.timeoutMs),
      });
      if (res.status >= 500 && intento < maxIntentos - 1) {
        ultimoError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (error) {
      ultimoError = error;
      if (intento >= maxIntentos - 1) break;
    } finally {
      semaforoRed.release();
    }
  }
  throw new Error(`No se pudo descargar ${url}: ${mensajeError(ultimoError)}`);
}

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface EntradaCache {
  url: string;
  url_final: string;
  status: number;
  content_type: string;
  fecha: string;
  cuerpo: string;
}

async function leerCache(
  url: string,
  dir: string,
  dias: number,
  ahora: number,
  render: boolean,
): Promise<Descarga | null> {
  try {
    const texto = await readFile(join(dir, `${claveCache(url, render)}.json`), 'utf8');
    const entrada = JSON.parse(texto) as EntradaCache;
    if (typeof entrada.cuerpo !== 'string' || typeof entrada.fecha !== 'string') return null;
    if (!esFuenteAceptada(entrada.url_final)) return null;
    const edad = ahora - Date.parse(entrada.fecha);
    if (!Number.isFinite(edad) || edad > dias * 24 * 60 * 60 * 1000) return null;
    const tipo = tipoDeContenido(entrada.content_type);
    return {
      url: entrada.url,
      url_final: entrada.url_final,
      status: entrada.status,
      content_type: entrada.content_type,
      fecha: entrada.fecha,
      cuerpo: entrada.cuerpo,
      tipo: tipo === 'otro' && entrada.cuerpo ? olerContenido(entrada.cuerpo) : tipo,
      desde_cache: true,
    };
  } catch {
    return null;
  }
}

async function guardarCache(descarga: Descarga, dir: string, render: boolean): Promise<void> {
  if (descarga.tipo !== 'html' && descarga.tipo !== 'json' && descarga.tipo !== 'texto') return;
  if (descarga.status < 200 || descarga.status >= 300) return;
  try {
    await mkdir(dir, { recursive: true });
    const entrada: EntradaCache = {
      url: descarga.url,
      url_final: descarga.url_final,
      status: descarga.status,
      content_type: descarga.content_type,
      fecha: descarga.fecha,
      cuerpo: descarga.cuerpo,
    };
    await writeFile(join(dir, `${claveCache(descarga.url, render)}.json`), JSON.stringify(entrada), 'utf8');
  } catch {
    // La caché es una optimización: si falla, seguimos con la descarga en memoria.
  }
}

/** Borra las entradas de caché normal y renderizada (útil con `--sin-cache`). */
export async function invalidarCache(url: string, dir = rutaDatos('paginas')): Promise<void> {
  await Promise.all([
    rm(join(dir, `${claveCache(url, false)}.json`), { force: true }),
    rm(join(dir, `${claveCache(url, true)}.json`), { force: true }),
  ]);
}

/**
 * Descarga una página oficial respetando robots.txt, límites de ritmo y caché en disco.
 * Cualquier URL (inicial o de una redirección) que no sea oficial se rechaza.
 */
export async function descargar(urlOriginal: string, opciones: OpcionesDescarga = {}): Promise<Descarga> {
  validarOficial(urlOriginal);

  const ahoraFn = opciones.ahora ?? Date.now;
  const dirCache = opciones.dirCache ?? rutaDatos('paginas');
  const cacheDias = opciones.cacheDias ?? CACHE_DIAS;
  const conRender = opciones.renderizar === true;

  if (!opciones.sinCache) {
    const enCache = await leerCache(urlOriginal, dirCache, cacheDias, ahoraFn(), conRender);
    if (enCache) return enCache;
  } else {
    await invalidarCache(urlOriginal, dirCache);
  }

  const fetchFn = opciones.fetch ?? globalThis.fetch;
  const config: ConfigRed = {
    fetch: fetchFn,
    timeoutMs: opciones.timeoutMs ?? TIMEOUT_MS,
    esperaMs: opciones.esperaMs ?? ESPERA_MS,
    reintentos: opciones.reintentos ?? REINTENTOS,
    intervaloHostMs: opciones.intervaloHostMs ?? INTERVALO_HOST_MS,
  };
  const cacheRobots = opciones.robotsCache ?? robotsEnMemoria;

  if (conRender) {
    await comprobarRobots(urlOriginal, config, cacheRobots);
    const renderizador = opciones.renderizador ?? (await import('./navegador.js')).renderizar;
    const resultado = await renderizador(urlOriginal, {
      intervaloHostMs: config.intervaloHostMs,
    });
    validarOficial(resultado.url_final);
    if (resultado.url_final !== urlOriginal) {
      await comprobarRobots(resultado.url_final, config, cacheRobots);
    }
    const descarga: Descarga = {
      url: urlOriginal,
      url_final: resultado.url_final,
      status: 200,
      content_type: 'text/html',
      fecha: new Date(ahoraFn()).toISOString(),
      cuerpo: resultado.html,
      tipo: 'html',
      desde_cache: false,
    };
    await guardarCache(descarga, dirCache, true);
    return descarga;
  }

  let actual = urlOriginal;
  let status = 0;
  let contentType = '';
  let cuerpo = '';
  const maxSaltos = opciones.maxRedirecciones ?? MAX_REDIRECCIONES;

  for (let salto = 0; salto <= maxSaltos; salto += 1) {
    await comprobarRobots(actual, config, cacheRobots);

    const res = await pedirRed(actual, config);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Redirección sin Location desde ${actual}`);
      if (salto === maxSaltos) throw new Error(`Demasiadas redirecciones desde ${urlOriginal}`);
      const siguiente = new URL(location, actual).toString();
      validarOficial(siguiente);
      actual = siguiente;
      continue;
    }

    status = res.status;
    contentType = res.headers.get('content-type') ?? '';
    const ruta = new URL(actual).pathname;
    const esGzip = /gzip/i.test(contentType) || /\.gz$/i.test(ruta);
    let tipo: TipoContenido;
    if (esGzip) {
      // Los sitemaps `.xml.gz` llegan como binario; los descomprimimos para leer el XML.
      const bytes = new Uint8Array(await res.arrayBuffer());
      try {
        cuerpo = gunzipSync(bytes).toString('utf8');
      } catch {
        // Algunos servidores mandan el gzip ya descomprimido por fetch.
        cuerpo = new TextDecoder().decode(bytes);
      }
      tipo = 'texto';
      contentType = 'application/xml';
    } else {
      tipo = tipoDeContenido(contentType);
      if (contentType.trim() === '') {
        cuerpo = await res.text();
        tipo = olerContenido(cuerpo);
        if (tipo === 'otro') cuerpo = '';
      } else if (tipo === 'pdf' || tipo === 'otro') {
        cuerpo = '';
      } else {
        cuerpo = await res.text();
      }
    }
    const descarga: Descarga = {
      url: urlOriginal,
      url_final: actual,
      status,
      content_type: contentType,
      fecha: new Date(ahoraFn()).toISOString(),
      cuerpo,
      tipo,
      desde_cache: false,
    };
    await guardarCache(descarga, dirCache, false);
    return descarga;
  }

  throw new Error(`No se pudo resolver ${urlOriginal}`);
}
