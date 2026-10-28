import type { EntradaCatalogo } from '@tramitando/shared';
import type { Descarga, OpcionesDescarga } from './descargar.js';
import { fichasDesdeSitemaps } from './sitemap.js';
import { extraerTexto, type LinkPagina } from './texto.js';

export type DescargarFn = (url: string, opciones?: OpcionesDescarga) => Promise<Descarga>;

export interface PortalCrawlable {
  jurisdiccion_id: string;
  nombre: string;
  guia_url: string;
  listado_urls: string[];
  regex_fichas: string | null;
  /** Páginas de categorías del portal: también son semillas y amplían el alcance. */
  categorias_urls?: string[];
}

export type ClasificadorLinks = (
  links: LinkPagina[],
  portal: PortalCrawlable,
) => Promise<{ fichas: string[]; listado: string[] }>;

export interface OpcionesCrawler {
  descargar?: DescargarFn;
  maxPaginas?: number;
  clasificar?: ClasificadorLinks;
  alProgreso?: (mensaje: string) => void;
  /** Fuerza el navegador en todas las páginas del portal (CLI `--render`). */
  renderizar?: boolean;
}

const MAX_PAGINAS = 2000;
/** Debajo de estos umbrales una página HTML de listado se considera vacía y se reintenta con render. */
const LINKS_MINIMOS_RENDER = 5;
const TEXTO_MINIMO_RENDER = 500;

function normalizar(url: string): string {
  const u = new URL(url);
  u.hash = '';
  // Los parámetros de campaña no cambian la página y duplicarían fichas.
  for (const clave of [...u.searchParams.keys()]) if (clave.startsWith('utm_')) u.searchParams.delete(clave);
  return u.toString();
}

/** Cambia el host de las URLs del portal (por ejemplo, cuando la guía redirige de .gov.ar a .gob.ar). */
export function conHost(portal: PortalCrawlable, viejo: string, final: URL): PortalCrawlable {
  const mover = (url: string) => {
    const u = new URL(url);
    if (u.hostname.toLowerCase() === viejo) {
      u.protocol = final.protocol;
      u.hostname = final.hostname;
    }
    return u.toString();
  };
  return {
    ...portal,
    guia_url: mover(portal.guia_url),
    listado_urls: portal.listado_urls.map(mover),
    ...(portal.categorias_urls ? { categorias_urls: portal.categorias_urls.map(mover) } : {}),
  };
}

function prefijoDe(url: string): string {
  const ruta = new URL(url).pathname;
  if (ruta === '/' || ruta === '') return '/';
  return ruta.replace(/\/+$/, '');
}

function prefijosDe(portal: PortalCrawlable): string[] {
  const urls = [portal.guia_url, ...portal.listado_urls, ...(portal.categorias_urls ?? [])];
  const prefijos = new Set<string>();
  for (const url of urls) {
    try {
      prefijos.add(prefijoDe(url));
    } catch {
      // Una URL inválida no aporta prefijo.
    }
  }
  return [...prefijos];
}

function mismoHost(url: string, host: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

function dentroDeAlcance(url: string, host: string, prefijos: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname.toLowerCase() !== host) return false;
  return prefijos.some(
    (prefijo) => prefijo === '/' || u.pathname === prefijo || u.pathname.startsWith(`${prefijo}/`),
  );
}

function compilarRegex(regex: string): RegExp {
  try {
    return new RegExp(regex);
  } catch (error) {
    throw new Error(
      `Regex de fichas inválida (${regex}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function nombreDesdeLink(link: LinkPagina, titulo: string): string {
  const candidatos = [link.texto, titulo];
  for (const candidato of candidatos) {
    const limpio = candidato.replace(/\s+/g, ' ').trim();
    if (limpio.length >= 3) return limpio.slice(0, 300);
  }
  const ultimo = new URL(link.url).pathname.split('/').filter(Boolean).pop() ?? link.url;
  let decodificado = ultimo;
  try {
    decodificado = decodeURIComponent(ultimo);
  } catch {
    // Se queda el segmento crudo.
  }
  return (decodificado.replace(/[-_]+/g, ' ').trim() || link.url).slice(0, 300);
}

function entradaCatalogo(
  url: string,
  nombre_oficial: string,
  portal: PortalCrawlable,
): EntradaCatalogo {
  return {
    url,
    nombre_oficial,
    jurisdiccion_id: portal.jurisdiccion_id,
    organismo: null,
    temas_sugeridos: [],
    portal: portal.guia_url,
  };
}

/**
 * Recorre en BFS la guía de un portal, acotado a su host y a los prefijos de la guía,
 * los listados y las categorías. Junta como fichas las URLs del mismo host que matchean
 * `regex_fichas` (o que clasifica Gemini) y, si hay regex, también las de los sitemaps.
 */
export async function crawlearPortal(
  portalOriginal: PortalCrawlable,
  opciones: OpcionesCrawler = {},
): Promise<EntradaCatalogo[]> {
  const descargarFn = opciones.descargar;
  if (!descargarFn) throw new Error('crawlearPortal necesita una función descargar');
  // Si la guía redirige a otro host, el alcance se calcula sobre el host final.
  let portal = portalOriginal;
  try {
    const inicial = await descargarFn(portal.guia_url);
    const viejo = new URL(portal.guia_url).hostname.toLowerCase();
    const final = new URL(inicial.url_final);
    if (final.hostname.toLowerCase() !== viejo) {
      portal = conHost(portal, viejo, final);
      opciones.alProgreso?.(`  la guía redirige a ${final.hostname}`);
    }
  } catch {
    // Si falla, el BFS lo vuelve a intentar y lo informa.
  }
  const maxPaginas = opciones.maxPaginas ?? MAX_PAGINAS;
  const host = new URL(portal.guia_url).hostname.toLowerCase();
  const prefijos = prefijosDe(portal);
  const regex = portal.regex_fichas ? compilarRegex(portal.regex_fichas) : null;

  const cola: string[] = [];
  const enCola = new Set<string>();
  const visitadas = new Set<string>();
  const encolar = (url: string, forzar = false) => {
    let limpia: string;
    try {
      limpia = normalizar(url);
    } catch {
      return;
    }
    if (visitadas.has(limpia) || enCola.has(limpia)) return;
    if (!dentroDeAlcance(limpia, host, prefijos)) return;
    if (!forzar && regex?.test(limpia)) return;
    enCola.add(limpia);
    cola.push(limpia);
  };

  encolar(portal.guia_url, true);
  for (const listado of portal.listado_urls) encolar(listado, true);
  for (const categoria of portal.categorias_urls ?? []) encolar(categoria, true);

  const fichas = new Map<string, EntradaCatalogo>();
  const desdeSitemap = new Set<string>();
  const sinTextoDeLink = new Set<string>();

  if (regex) {
    try {
      const delSitemap = await fichasDesdeSitemaps({
        descargar: descargarFn,
        host,
        regex,
        alProgreso: opciones.alProgreso,
      });
      for (const ficha of delSitemap) {
        if (fichas.has(ficha.url)) continue;
        fichas.set(ficha.url, entradaCatalogo(ficha.url, ficha.nombre_oficial, portal));
        desdeSitemap.add(ficha.url);
      }
    } catch (error) {
      opciones.alProgreso?.(
        `  sitemap falló: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let paginas = 0;
  // Si el portal necesitó render una vez, todas sus páginas se piden renderizadas.
  let usaRender = opciones.renderizar === true;

  while (cola.length > 0 && paginas < maxPaginas) {
    const url = cola.shift() as string;
    enCola.delete(url);
    if (visitadas.has(url)) continue;
    visitadas.add(url);
    paginas += 1;

    let descarga: Descarga;
    try {
      descarga = await descargarFn(url, usaRender ? { renderizar: true } : undefined);
    } catch (error) {
      opciones.alProgreso?.(
        `  salteada ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (descarga.tipo === 'pdf' || descarga.tipo === 'otro') {
      opciones.alProgreso?.(`  salteada ${url}: contenido ${descarga.tipo}`);
      continue;
    }

    let resultado: { titulo: string; texto: string; links: LinkPagina[] };
    if (descarga.tipo === 'html') {
      resultado = extraerTexto(descarga.cuerpo, descarga.url_final);
    } else {
      resultado = { titulo: '', texto: '', links: [] };
    }

    if (descarga.tipo === 'html' && !usaRender) {
      const enAlcance = resultado.links.filter((link) => dentroDeAlcance(link.url, host, prefijos));
      if (enAlcance.length < LINKS_MINIMOS_RENDER && resultado.texto.length < TEXTO_MINIMO_RENDER) {
        try {
          const renderizada = await descargarFn(url, { renderizar: true });
          if (renderizada.tipo === 'html') {
            const alternativa = extraerTexto(renderizada.cuerpo, renderizada.url_final);
            const enAlcanceRender = alternativa.links.filter((link) =>
              dentroDeAlcance(link.url, host, prefijos),
            );
            if (
              enAlcanceRender.length > enAlcance.length ||
              alternativa.texto.length > resultado.texto.length
            ) {
              descarga = renderizada;
              resultado = alternativa;
              usaRender = true;
              opciones.alProgreso?.(`  ${url}: página armada con JavaScript, se usa el navegador`);
            }
          }
        } catch (error) {
          opciones.alProgreso?.(
            `  render falló en ${url}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    opciones.alProgreso?.(`  ${paginas}/${maxPaginas} ${url}`);

    const links = resultado.links.filter((link) => mismoHost(link.url, host));

    let candidatas: string[] = [];
    let paraVisitar: string[] = [];

    if (regex) {
      candidatas = links.filter((link) => regex.test(link.url)).map((link) => link.url);
      paraVisitar = links
        .filter((link) => !regex.test(link.url) && dentroDeAlcance(link.url, host, prefijos))
        .map((link) => link.url);
    } else if (opciones.clasificar) {
      const enAlcance = links.filter((link) => dentroDeAlcance(link.url, host, prefijos));
      try {
        const clases = await opciones.clasificar(enAlcance, portal);
        candidatas = clases.fichas;
        paraVisitar = clases.listado;
      } catch (error) {
        opciones.alProgreso?.(
          `  clasificación falló en ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
        paraVisitar = [];
      }
    }

    for (const candidata of candidatas) {
      let limpia: string;
      try {
        limpia = normalizar(candidata);
      } catch {
        continue;
      }
      const link = links.find((l) => normalizar(l.url) === limpia);
      const conTexto = !!link && link.texto.trim().length >= 3;
      const existente = fichas.get(limpia);
      if (existente) {
        if (conTexto && link) {
          existente.nombre_oficial = nombreDesdeLink(link, resultado.titulo || url);
          sinTextoDeLink.delete(limpia);
        }
        continue;
      }
      if (!conTexto) sinTextoDeLink.add(limpia);
      fichas.set(
        limpia,
        entradaCatalogo(
          limpia,
          nombreDesdeLink(link ?? { url: limpia, texto: '' }, resultado.titulo || url),
          portal,
        ),
      );
    }

    for (const siguiente of paraVisitar) encolar(siguiente);
  }

  for (const url of sinTextoDeLink) {
    try {
      const descarga = await descargarFn(url, usaRender ? { renderizar: true } : undefined);
      if (descarga.tipo !== 'html') continue;
      const { titulo } = extraerTexto(descarga.cuerpo, descarga.url_final, { maxTexto: 1000 });
      const ficha = fichas.get(url);
      if (ficha && titulo.length >= 3) ficha.nombre_oficial = titulo.slice(0, 300);
    } catch {
      // Si la ficha no se puede leer, se queda el nombre provisorio.
    }
  }

  const delBfs = [...fichas.keys()].filter((url) => !desdeSitemap.has(url)).length;
  opciones.alProgreso?.(
    `  fichas: ${desdeSitemap.size} del sitemap, ${delBfs} del BFS (${fichas.size} total)`,
  );

  return [...fichas.values()];
}
