import { chromium, type Browser } from 'playwright-core';
import { esFuenteAceptada } from './confirmados.js';
import { esperarTurnoHost } from './descargar.js';

export type DecisionPedido = 'continuar' | 'abortar';

export interface ResultadoRender {
  html: string;
  url_final: string;
}

export interface OpcionesRender {
  /** Separación mínima entre pedidos al mismo host. Por defecto 1000 ms, igual que `descargar`. */
  intervaloHostMs?: number;
  /** Timeout de `networkidle`. Por defecto 30 s. */
  timeoutMs?: number;
  /** Espera máxima a que haya links. Por defecto 10 s. */
  esperaPorLinksMs?: number;
  /** Cantidad de links que se consideran suficientes. Por defecto 5. */
  linksMinimos?: number;
}

const RECURSOS_PESADOS = new Set(['image', 'font', 'media']);
const TIMEOUT_NAVEGACION_MS = 30_000;
const ESPERA_LINKS_MS = 10_000;
const LINKS_MINIMOS = 5;
const INTERVALO_HOST_MS = 1000;

let navegador: Browser | null = null;
let lanzamiento: Promise<Browser> | null = null;

/**
 * Decide qué hacer con un pedido interceptado por `page.route`. El navegador solo puede
 * pedir documentos a hosts oficiales (incluidas las redirecciones); scripts, XHR y demás
 * recursos de terceros se permiten porque la página los necesita para armarse.
 */
export function decidirPedido(resourceType: string, url: string): DecisionPedido {
  if (RECURSOS_PESADOS.has(resourceType)) return 'abortar';
  if (resourceType === 'document' && !esFuenteAceptada(url)) return 'abortar';
  return 'continuar';
}

function hostDe(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

async function obtenerNavegador(): Promise<Browser> {
  if (navegador?.isConnected()) return navegador;
  if (!lanzamiento) {
    lanzamiento = chromium
      .launch({ channel: 'msedge', headless: true })
      .then((instancia) => {
        navegador = instancia;
        return instancia;
      })
      .finally(() => {
        lanzamiento = null;
      });
  }
  return lanzamiento;
}

/** Cierra la instancia compartida. Es seguro llamarla aunque nunca se haya abierto el navegador. */
export async function cerrarNavegador(): Promise<void> {
  if (lanzamiento) {
    try {
      await lanzamiento;
    } catch {
      // Si el lanzamiento falló no hay nada que cerrar.
    }
  }
  const actual = navegador;
  navegador = null;
  if (!actual) return;
  try {
    await actual.close();
  } catch {
    // El cierre es best-effort al final del proceso.
  }
}

function esTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || /timeout/i.test(error.message))
  );
}

/**
 * Abre una URL oficial con el Edge instalado en la máquina y devuelve el HTML ya armado
 * por JavaScript. Reutiliza una única instancia del navegador durante todo el proceso.
 */
export async function renderizar(url: string, opciones: OpcionesRender = {}): Promise<ResultadoRender> {
  if (!esFuenteAceptada(url)) throw new Error(`URL no oficial: ${url}`);

  const intervalo = opciones.intervaloHostMs ?? INTERVALO_HOST_MS;
  const timeout = opciones.timeoutMs ?? TIMEOUT_NAVEGACION_MS;
  const esperaPorLinks = opciones.esperaPorLinksMs ?? ESPERA_LINKS_MS;
  const linksMinimos = opciones.linksMinimos ?? LINKS_MINIMOS;

  const instancia = await obtenerNavegador();
  const contexto = await instancia.newContext();
  try {
    const pagina = await contexto.newPage();
    let primerDocumento = true;

    await pagina.route('**/*', async (ruta) => {
      const pedido = ruta.request();
      const tipo = pedido.resourceType();
      if (decidirPedido(tipo, pedido.url()) === 'abortar') {
        await ruta.abort().catch(() => undefined);
        return;
      }
      if (tipo === 'document') {
        if (primerDocumento) {
          primerDocumento = false;
        } else {
          try {
            await esperarTurnoHost(hostDe(pedido.url()), intervalo);
          } catch {
            // Una URL inválida la resuelve Playwright.
          }
        }
      }
      await ruta.continue().catch(() => undefined);
    });

    await esperarTurnoHost(hostDe(url), intervalo);
    try {
      await pagina.goto(url, { waitUntil: 'networkidle', timeout });
    } catch (error) {
      // Muchas páginas con polling nunca llegan a networkidle: seguimos con lo que cargaron.
      if (!esTimeout(error)) throw error;
    }

    await pagina
      .waitForFunction(
        (minimo) => document.querySelectorAll('a[href]').length >= minimo,
        linksMinimos,
        { timeout: esperaPorLinks, polling: 250 },
      )
      .catch(() => undefined);

    const html = await pagina.content();
    return { html, url_final: pagina.url() || url };
  } finally {
    await contexto.close().catch(() => undefined);
  }
}
