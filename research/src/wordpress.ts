/**
 * Atajo para sitios hechos con WordPress (más de la mitad de los municipales): la API pública
 * `/wp-json/wp/v2/pages` devuelve todas las páginas con su título en uno o pocos pedidos, sin recorrer
 * el sitio. Los títulos se clasifican con las mismas reglas del recorrido,
 * sin IA. Si el sitio no es WordPress o la API está cerrada, devuelve null.
 */
import type { DescargarFn } from './crawler.js';
import { clasificarPorReglas } from './reglas.js';
import type { LinkPagina } from './texto.js';

/** Tope de páginas de 100 que se piden por tipo de contenido (hasta 1000 páginas). */
const MAX_TANDAS = 10;

interface PaginaWp {
  link?: string;
  title?: { rendered?: string };
}

const ENTIDADES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
};

/** "Licencias &#8211; Renovaci&oacute;n" → "Licencias – Renovación" (lo que manda WordPress en `title.rendered`). */
export function textoDeTitulo(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTIDADES[n] ?? ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const sinWww = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** Bases posibles de la API: la ruta del sitio (WordPress instalado en /web/) y la raíz del host. */
function basesApi(sitio: string): string[] {
  const u = new URL(sitio);
  const ruta = u.pathname.replace(/\/+$/, '');
  return [...new Set([`${u.origin}${ruta}/wp-json/wp/v2`, `${u.origin}/wp-json/wp/v2`])];
}

async function pedirJson(descargar: DescargarFn, url: string): Promise<unknown> {
  const d = await descargar(url);
  if (d.status >= 400 || !d.cuerpo) return null;
  try {
    return JSON.parse(d.cuerpo);
  } catch {
    return null;
  }
}

/** Todas las entradas de un tipo (pages o un tipo propio como `tramites`), de a 100. */
async function listarTipo(descargar: DescargarFn, base: string, rest: string): Promise<PaginaWp[] | null> {
  const todas: PaginaWp[] = [];
  for (let n = 1; n <= MAX_TANDAS; n += 1) {
    const sep = rest.includes('?') ? '&' : '?';
    const lote = await pedirJson(descargar, `${base}/${rest}${sep}per_page=100&page=${n}&_fields=link,title`).catch(() => null);
    if (!Array.isArray(lote)) return n === 1 ? null : todas;
    todas.push(...(lote as PaginaWp[]));
    if (lote.length < 100) break;
  }
  return todas;
}

const SECCION_TRAMITES = /^(tramites?|guia-?de-?tramites|guiadetramites|servicios?|atencion-al-vecino)$/;

/**
 * Secciones de trámites que linkea la portada (`/tramites/`, `/categoria/tramites/`, …) y que no tienen
 * ninguna URL en lo que devolvió la API: ahí hay trámites que la API no publica y hay que recorrer.
 */
export function seccionesSinCubrir(links: LinkPagina[], hostSitio: string, urlsApi: string[]): string[] {
  const rutasApi = urlsApi.map((u) => new URL(u).pathname.toLowerCase());
  const secciones = new Set<string>();
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (sinWww(u.hostname) !== sinWww(hostSitio)) continue;
    const segmentos = decodeURIComponent(u.pathname).toLowerCase().split('/').filter(Boolean);
    const i = segmentos.findIndex((s) => SECCION_TRAMITES.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '')));
    if (i >= 0) secciones.add(`/${segmentos.slice(0, i + 1).join('/')}/`);
  }
  return [...secciones].filter((s) => !rutasApi.some((r) => r.startsWith(s) && r.length > s.length));
}

/** Páginas de área que suelen agrupar trámites ("Registro Civil", "Catastro", "Trámites comerciales"). */
const AREA_CON_TRAMITES =
  /(tramite|servicio|registro civil|licencia|catastro|obras|defensa|consumidor|comercio|rentas|tasas|transito|habilitacion|atencion|guia|bromatologia|zoonosis|cementerio|faltas|ingresos publicos|hacienda)/;

/** Textos de link que no dicen nada del trámite: no sirven como nombre. */
const GENERICO = /^(ver|leer|explorar|conoce|saber|mas info|click|clic|ingresa|acceder|descargar|aqui)\b.{0,15}$|^(\+|mas)$/;

/** Hasta cuántas páginas de área se bajan para buscar trámites que la API no publica. */
export const MAX_AREAS = 20;

/**
 * Mini-recorrido sin IA: baja las páginas de área que publicó la API (las que las reglas no toman como
 * trámite pero suelen agrupar trámites) y suma los links que las reglas marcan como trámite. Un solo nivel.
 */
export async function tramitesDeAreas(
  links: LinkPagina[],
  conocidas: Set<string>,
  descargar: DescargarFn,
): Promise<{ url: string; nombre_oficial: string }[]> {
  const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clave = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  // Primero las que no son trámite (índices puros) y después las que sí pero tienen nombre de área
  // ("Registro Civil" cuenta como trámite y suele ser un índice con trámites adentro).
  const candidatas = links.filter(
    (l) => clasificarPorReglas(l, new URL(l.url).hostname) !== 'descartar' && AREA_CON_TRAMITES.test(sinTildes(`${l.texto} ${new URL(l.url).pathname}`)),
  );
  const esFicha = (l: LinkPagina) => clasificarPorReglas(l, new URL(l.url).hostname) === 'ficha';
  const areas = [...candidatas.filter((l) => !esFicha(l)), ...candidatas.filter(esFicha)].slice(0, MAX_AREAS);
  const vistas = new Set([...conocidas].map(clave));
  const nuevas: { url: string; nombre_oficial: string }[] = [];
  const { extraerTexto } = await import('./texto.js');
  for (const a of areas) {
    let d;
    try {
      d = await descargar(a.url);
    } catch {
      continue;
    }
    if (d.tipo !== 'html' || d.status >= 400) continue;
    const host = sinWww(new URL(a.url).hostname);
    for (const l of extraerTexto(d.cuerpo, d.url_final).links) {
      let h: string;
      try {
        h = new URL(l.url).hostname;
      } catch {
        continue;
      }
      if (sinWww(h) !== host || vistas.has(clave(l.url)) || l.texto.length < 3 || /[{}]/.test(l.texto) || GENERICO.test(sinTildes(l.texto).trim())) continue;
      if (clasificarPorReglas(l, h) !== 'ficha') continue;
      vistas.add(clave(l.url));
      nuevas.push({ url: l.url, nombre_oficial: l.texto.slice(0, 300) });
    }
  }
  return nuevas;
}

export interface ResultadoWordPress {
  fichas: { url: string; nombre_oficial: string }[];
  /** Todas las URLs que publicó la API, sean trámites o no. */
  urls: string[];
  /** Las mismas, con su título. */
  links: LinkPagina[];
  /** Cuántos títulos leyó de la API. */
  titulos: number;
}

/**
 * Trámites del sitio a partir de la API de WordPress. Las páginas índice ("Trámites", "Guía de trámites")
 * se descartan: ya están todas las páginas, no hace falta recorrerlas.
 */
export async function tramitesDeWordPress(
  sitio: string,
  o: { descargar: DescargarFn },
): Promise<ResultadoWordPress | null> {
  let base: string | undefined;
  let paginas: PaginaWp[] | null = null;
  for (const b of basesApi(sitio)) {
    paginas = await listarTipo(o.descargar, b, 'pages');
    if (paginas) {
      base = b;
      break;
    }
  }
  if (!base || !paginas) return null;

  // Lo que el propio municipio catalogó como trámite: un tipo propio ("tramite", "servicio") o las entradas
  // de una categoría "Trámites". `docs` es BetterDocs, un plugin que varios usan para la guía de trámites.
  const propias: PaginaWp[] = [];
  const tipos = await pedirJson(o.descargar, `${base}/types`).catch(() => null);
  if (tipos && typeof tipos === 'object') {
    for (const t of Object.values(tipos as Record<string, { slug?: string; rest_base?: string }>)) {
      if (t?.rest_base && /tramite|servicio|guia|(^|\s)docs(\s|$)/i.test(`${t.slug} ${t.rest_base}`)) {
        propias.push(...((await listarTipo(o.descargar, base, t.rest_base)) ?? []));
      }
    }
  }
  const categorias = await pedirJson(o.descargar, `${base}/categories?per_page=100&_fields=id,slug,name`).catch(() => null);
  if (Array.isArray(categorias)) {
    const ids = (categorias as { id?: number; slug?: string; name?: string }[])
      .filter((c) => c.id && /tramite|servicio|guia/i.test(`${c.slug} ${textoDeTitulo(c.name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')}`))
      .map((c) => c.id);
    if (ids.length) propias.push(...((await listarTipo(o.descargar, base, `posts?categories=${ids.join(',')}`)) ?? []));
  }

  const host = sinWww(new URL(sitio).hostname);
  const vistos = new Set<string>();
  const aLinks = (lista: PaginaWp[]): LinkPagina[] =>
    lista.flatMap((p) => {
      if (!p.link || vistos.has(p.link)) return [];
      try {
        if (sinWww(new URL(p.link).hostname) !== host) return [];
      } catch {
        return [];
      }
      vistos.add(p.link);
      return [{ url: p.link, texto: textoDeTitulo(p.title?.rendered ?? '') }];
    });
  const linksPropios = aLinks(propias);
  const linksPaginas = aLinks(paginas);

  // Sin IA: con solo el título, el 2B aceptaba casi todo ("Política de privacidad", "sidebar"). Lo catalogado
  // por el sitio entra salvo ruido seguro; las páginas comunes, solo si las reglas dicen que son trámite.
  const fichas = new Map<string, string>();
  const agregar = (l: LinkPagina) => {
    if (l.texto.length >= 3) fichas.set(l.url, l.texto.slice(0, 300));
  };
  for (const l of linksPropios) {
    const clase = clasificarPorReglas(l, new URL(l.url).hostname);
    if (clase !== 'descartar' && clase !== 'listado') agregar(l);
  }
  for (const l of linksPaginas) {
    if (clasificarPorReglas(l, new URL(l.url).hostname) === 'ficha') agregar(l);
  }
  const links = [...linksPropios, ...linksPaginas];
  return { fichas: [...fichas].map(([url, nombre_oficial]) => ({ url, nombre_oficial })), urls: links.map((l) => l.url), links, titulos: links.length };
}
