import type { DescargarFn } from './crawler.js';

export interface FichaDeSitemap {
  url: string;
  nombre_oficial: string;
}

export interface OpcionesSitemaps {
  descargar: DescargarFn;
  host: string;
  regex: RegExp;
  alProgreso?: (mensaje: string) => void;
  /** Máximo de archivos de sitemap por host, incluidos los índices. */
  maxArchivos?: number;
}

const MAX_ARCHIVOS = 200;

const RE_LOC = /<\s*loc\s*>([\s\S]*?)<\s*\/\s*loc\s*>/gi;
const RE_INDICE = /<\s*sitemapindex[\s>]/i;
const RE_SITEMAP_ROBOTS = /^\s*sitemap\s*:\s*(\S+)\s*$/i;

function decodificarXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, numero: string) => String.fromCodePoint(Number(numero)))
    .replace(/&#x([0-9a-f]+);/gi, (_, numero: string) => String.fromCodePoint(parseInt(numero, 16)))
    .replace(/&amp;/g, '&');
}

/** Extrae los `<loc>` de un sitemap, resolviendo CDATA y entidades XML básicas. */
export function extraerLocs(xml: string): string[] {
  const locs: string[] = [];
  for (const coincidencia of xml.matchAll(RE_LOC)) {
    let valor = (coincidencia[1] ?? '').trim();
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(valor);
    if (cdata) valor = (cdata[1] ?? '').trim();
    if (!valor) continue;
    locs.push(decodificarXml(valor));
  }
  return locs;
}

export function esIndiceDeSitemaps(xml: string): boolean {
  return RE_INDICE.test(xml);
}

function mismoHost(url: URL, host: string): boolean {
  return url.hostname.toLowerCase() === host;
}

function normalizar(url: URL): string {
  url.hash = '';
  return url.toString();
}

/** Nombre provisorio a partir del último segmento del path, sin guiones. */
export function nombreProvisorio(url: string): string {
  const u = new URL(url);
  const segmentos = u.pathname.split('/').filter(Boolean);
  let segmento = segmentos[segmentos.length - 1] ?? '';
  try {
    segmento = decodeURIComponent(segmento);
  } catch {
    // Se usa el segmento crudo.
  }
  const limpio = segmento.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (limpio || u.hostname).slice(0, 300);
}

/**
 * Descubre los sitemaps del host: primero las líneas `Sitemap:` de robots.txt y,
 * si no hay, `https://<host>/sitemap.xml`. Los índices se recorren recursivamente
 * y los `.xml.gz` se descomprimen en `descargar`. Devuelve solo las URLs que
 * matchean la regex de fichas.
 */
export async function fichasDesdeSitemaps(opciones: OpcionesSitemaps): Promise<FichaDeSitemap[]> {
  const host = opciones.host.toLowerCase();
  const maxArchivos = opciones.maxArchivos ?? MAX_ARCHIVOS;
  const semillas = await descubrirSitemaps(host, opciones);

  if (semillas.length === 0) {
    opciones.alProgreso?.('  sitemap: no se encontraron sitemaps, sigo con BFS');
    return [];
  }

  const pendientes = [...semillas];
  const visitados = new Set<string>();
  const fichas = new Map<string, FichaDeSitemap>();
  let archivos = 0;

  while (pendientes.length > 0 && archivos < maxArchivos) {
    const url = pendientes.shift() as string;
    if (visitados.has(url)) continue;
    visitados.add(url);
    archivos += 1;

    let descarga;
    try {
      descarga = await opciones.descargar(url);
    } catch (error) {
      opciones.alProgreso?.(
        `  sitemap salteado ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (descarga.status < 200 || descarga.status >= 300) {
      opciones.alProgreso?.(`  sitemap ${url}: HTTP ${descarga.status}`);
      continue;
    }
    if (descarga.tipo !== 'texto' && descarga.tipo !== 'html') continue;

    const cuerpo = descarga.cuerpo;
    if (esIndiceDeSitemaps(cuerpo)) {
      for (const loc of extraerLocs(cuerpo)) {
        let absoluta: URL;
        try {
          absoluta = new URL(loc, url);
        } catch {
          continue;
        }
        if (!mismoHost(absoluta, host)) continue;
        pendientes.push(normalizar(absoluta));
      }
      continue;
    }

    for (const loc of extraerLocs(cuerpo)) {
      let absoluta: URL;
      try {
        absoluta = new URL(loc, url);
      } catch {
        continue;
      }
      if (!mismoHost(absoluta, host)) continue;
      const limpia = normalizar(absoluta);
      opciones.regex.lastIndex = 0;
      if (!opciones.regex.test(limpia) || fichas.has(limpia)) continue;
      fichas.set(limpia, { url: limpia, nombre_oficial: nombreProvisorio(limpia) });
    }
  }

  if (archivos >= maxArchivos && pendientes.length > 0) {
    opciones.alProgreso?.(`  sitemap: tope de ${maxArchivos} archivos alcanzado`);
  }
  opciones.alProgreso?.(`  sitemap: ${archivos} archivos leídos, ${fichas.size} fichas`);
  return [...fichas.values()];
}

async function descubrirSitemaps(host: string, opciones: OpcionesSitemaps): Promise<string[]> {
  const urls: string[] = [];
  try {
    const robots = await opciones.descargar(`https://${host}/robots.txt`);
    if (robots.status >= 200 && robots.status < 300) {
      for (const linea of robots.cuerpo.split(/\r?\n/)) {
        const coincidencia = RE_SITEMAP_ROBOTS.exec(linea);
        if (!coincidencia) continue;
        try {
          const u = new URL(coincidencia[1] as string);
          if (mismoHost(u, host)) urls.push(normalizar(u));
        } catch {
          // Línea de sitemap inválida: se ignora.
        }
      }
    }
  } catch {
    // Sin robots.txt legible probamos el sitemap por defecto.
  }

  const distintas = [...new Set(urls)];
  if (distintas.length > 0) return distintas;
  return [`https://${host}/sitemap.xml`];
}
