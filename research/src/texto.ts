import { parse } from 'node-html-parser';

export interface LinkPagina {
  url: string;
  texto: string;
}

export interface TextoPagina {
  titulo: string;
  texto: string;
  links: LinkPagina[];
}

export interface OpcionesTexto {
  /** Recorte del texto principal. Por defecto 60 000 caracteres. */
  maxTexto?: number;
}

const MAX_TEXTO = 60_000;

function limpiarEspacios(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim();
}

/** Saca el `#fragmento` de una URL y normaliza el resto. */
export function sinFragmento(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

/**
 * Convierte HTML en título, texto legible y links absolutos.
 * Los links se recogen antes de borrar nav/header/footer: los menús sirven para descubrir la guía.
 */
export function extraerTexto(html: string, urlBase: string, opciones: OpcionesTexto = {}): TextoPagina {
  const raiz = parse(html, { comment: false });

  const titulo = limpiarEspacios(
    raiz.querySelector('title')?.text ?? raiz.querySelector('h1')?.text ?? '',
  );

  const vistos = new Set<string>();
  const links: LinkPagina[] = [];
  for (const a of raiz.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const crudo = href.trim();
    if (!crudo || crudo.startsWith('javascript:') || crudo.startsWith('mailto:') || crudo.startsWith('tel:')) {
      continue;
    }
    let absoluta: string;
    try {
      const u = new URL(crudo, urlBase);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      u.hash = '';
      absoluta = u.toString();
    } catch {
      continue;
    }
    if (vistos.has(absoluta)) continue;
    vistos.add(absoluta);
    links.push({ url: absoluta, texto: limpiarEspacios(a.text) });
  }

  for (const selector of ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'template']) {
    for (const nodo of raiz.querySelectorAll(selector)) nodo.remove();
  }

  const texto = limpiarEspacios(raiz.text).slice(0, opciones.maxTexto ?? MAX_TEXTO);
  return { titulo, texto, links };
}
