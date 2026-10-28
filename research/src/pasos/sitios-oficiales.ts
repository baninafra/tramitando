/**
 * Sitios web de los municipios desde fuentes oficiales, sin búsqueda web ni IA:
 * 1. ReFeGLo (Registro Federal de Gobiernos Locales, Ministerio del Interior, en datos.gob.ar): todo el país,
 *    con el mismo código que usamos (`cod_gobierno_local` 60007 → `muni-060007`).
 * 2. gba.gob.ar/municipios: los 135 de Buenos Aires, más actualizado; manda sobre ReFeGLo.
 * Guarda `data/sitios-oficiales.tsv` (id, url, fuente). municipio-local lo usa antes de adivinar direcciones.
 */
import { esUrlOficial } from '@tramitando/shared';
import { readFileSync, writeFileSync } from 'node:fs';
import { esperarLinea } from '../archivos.js';
import { rutaDatos } from '../rutas.js';

export const URL_REFEGLO =
  'http://datos.mininterior.gob.ar/dataset/8431ab79-3f44-41ee-b72b-cdc645f68d1e/resource/ebe52783-6a7f-4112-8a7f-a17c91cb6b4e/download/brgl_-portal-andino-23_12.csv';
export const URL_GBA = 'https://www.gba.gob.ar/municipios';

const compactar = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^municipalidad de /, '').replace(/[^a-z0-9]+/g, '');

/** "www.x.gob.ar/ " → "https://www.x.gob.ar/". null si no parece una dirección web. */
export function normalizarSitio(crudo: string): string | null {
  const t = crudo.trim().replace(/\s+.*$/, '');
  if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`;
  } catch {
    return null;
  }
}

/** CSV de ReFeGLo (separado por `;`) → id → sitio. */
export function parsearRefeglo(csv: string): Map<string, string> {
  const filas = csv.split(/\r?\n/).filter(Boolean).map((l) => l.split(';'));
  const cabecera = filas.shift() ?? [];
  const iCod = cabecera.indexOf('cod_gobierno_local');
  const iWeb = cabecera.indexOf('sitio_web');
  const sitios = new Map<string, string>();
  for (const f of filas) {
    const cod = (f[iCod] ?? '').trim();
    const sitio = normalizarSitio(f[iWeb] ?? '');
    if (/^\d+$/.test(cod) && sitio) sitios.set(`muni-${cod.padStart(6, '0')}`, sitio);
  }
  return sitios;
}

/** Página de municipios de gba.gob.ar → nombre compactado → sitio. Cada bloque tiene <h3>Nombre</h3> y el link. */
export function parsearGba(html: string): Map<string, string> {
  const sitios = new Map<string, string>();
  for (const m of html.matchAll(/<h3[^>]*>([^<]+)<\/h3>[\s\S]{0,400}?<a href="(https?:\/\/[^"]+)"/g)) {
    const sitio = normalizarSitio(m[2] as string);
    if (sitio) sitios.set(compactar(m[1] as string), sitio);
  }
  return sitios;
}

export interface SitioOficial {
  url: string;
  fuente: 'refeglo' | 'gba';
}

/** Lee `data/sitios-oficiales.tsv`: id → sitio. Vacío si todavía no se importó. */
export function leerSitiosOficiales(ruta = rutaDatos('sitios-oficiales.tsv')): Map<string, SitioOficial> {
  const sitios = new Map<string, SitioOficial>();
  try {
    for (const l of readFileSync(ruta, 'utf8').split('\n')) {
      const [id, url, fuente] = l.trim().split('\t');
      if (id && url) sitios.set(id, { url, fuente: fuente === 'gba' ? 'gba' : 'refeglo' });
    }
  } catch {
    // Sin importar: municipio-local sigue adivinando direcciones como antes.
  }
  return sitios;
}

export interface OpcionesSitiosOficiales {
  /** Inyectable en tests: devuelve el cuerpo crudo de cada fuente. */
  bajar?: (url: string) => Promise<Uint8Array>;
  municipiosTsv?: string;
  destino?: string;
}

export async function pasoSitiosOficiales(o: OpcionesSitiosOficiales = {}): Promise<number> {
  const bajar = o.bajar ?? (async (url: string) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  });
  // ReFeGLo viene en Latin-1.
  const refeglo = parsearRefeglo(new TextDecoder('latin1').decode(await bajar(URL_REFEGLO)));
  let gba = new Map<string, string>();
  try {
    gba = parsearGba(new TextDecoder('utf-8').decode(await bajar(URL_GBA)));
  } catch (error) {
    esperarLinea(`  gba.gob.ar no respondió (${error instanceof Error ? error.message : error}); sigo solo con ReFeGLo`);
  }

  const filas: string[] = [];
  let oficiales = 0;
  for (const l of readFileSync(o.municipiosTsv ?? rutaDatos('municipios-todos.tsv'), 'utf8').split('\n')) {
    const [id, nombre, , provincia] = l.trim().split('\t');
    if (!id || !nombre) continue;
    const deGba = provincia === 'Buenos Aires' ? gba.get(compactar(nombre)) : undefined;
    const url = deGba ?? refeglo.get(id);
    if (!url) continue;
    filas.push(`${id}\t${url}\t${deGba ? 'gba' : 'refeglo'}`);
    if (esUrlOficial(url)) oficiales += 1;
  }
  writeFileSync(o.destino ?? rutaDatos('sitios-oficiales.tsv'), `${filas.join('\n')}\n`);
  esperarLinea(`Sitios oficiales: ${filas.length} municipios con sitio (${oficiales} .gob.ar/.gov.ar), ${gba.size} desde gba.gob.ar`);
  return filas.length;
}

/** Plataformas compartidas y redes: su dominio no es de nadie en particular, nunca se acepta entero. */
const PLATAFORMAS = /(^|\.)(facebook|instagram|twitter|x|youtube|google|blogspot|wordpress|wixsite|wix|linktr|tiktok|whatsapp)\.(com|ee|me)(\.ar)?$/;

/** Dominio a aceptar para un sitio: el host sin "www.". null si es una plataforma compartida. */
export function dominioDe(url: string): string | null {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return PLATAFORMAS.test(host) ? null : host;
}

export interface OpcionesVerificarDominios {
  descargar: (url: string) => Promise<{ tipo: string; status: number; cuerpo: string; url_final: string }>;
  /** Permite descargar el host para la verificación (en la CLI: confirmarHost). */
  permitir: (url: string) => void;
  sitiosTsv?: string;
  municipiosTsv?: string;
  destino?: string;
}

/**
 * Verifica los sitios de las fuentes oficiales que no son .gob.ar/.gov.ar: la portada tiene que responder
 * con HTML, tener al menos 5 links y nombrar al municipio (así un dominio vencido que compró otro no pasa).
 * Escribe los que pasan en `packages/shared/src/dominios-municipales.ts`.
 */
export async function pasoVerificarDominios(o: OpcionesVerificarDominios): Promise<number> {
  const nombres = new Map<string, string>();
  for (const l of readFileSync(o.municipiosTsv ?? rutaDatos('municipios-todos.tsv'), 'utf8').split('\n')) {
    const [id, nombre, , provincia] = l.trim().split('\t');
    if (id && nombre) nombres.set(id, `${nombre} (${provincia})`);
  }
  const { extraerTexto } = await import('../texto.js');
  const aVerificar = [...leerSitiosOficiales(o.sitiosTsv)].filter(([, s]) => !esUrlOficial(s.url) && dominioDe(s.url));
  const aceptados = new Map<string, string>();
  let rechazados = 0;
  await Promise.all(
    aVerificar.map(async ([id, s]) => {
      const nombre = nombres.get(id);
      if (!nombre) return;
      const corto = compactar(nombre.replace(/ \(.*\)$/, ''));
      try {
        o.permitir(s.url);
        const d = await o.descargar(s.url);
        const { titulo, links, texto } = extraerTexto(d.cuerpo, d.url_final);
        const nombra = compactar(`${titulo} ${texto.slice(0, 20_000)}`).includes(corto) || compactar(d.url_final).includes(corto);
        const dominio = dominioDe(d.url_final);
        if (d.tipo === 'html' && d.status < 400 && links.length >= 5 && nombra && dominio) {
          aceptados.set(dominio, `${nombre}: sitio según ${s.fuente === 'gba' ? 'gba.gob.ar' : 'ReFeGLo (Min. Interior)'}`);
          return;
        }
      } catch {
        // No responde: no se acepta.
      }
      rechazados += 1;
    }),
  );
  const filas = [...aceptados].sort(([a], [b]) => a.localeCompare(b)).map(([d, m]) => `  ${JSON.stringify(d)}: ${JSON.stringify(m)},`);
  const destino = o.destino ?? rutaDatos('..', '..', 'packages', 'shared', 'src', 'dominios-municipales.ts');
  writeFileSync(
    destino,
    [
      '/**',
      ' * Sitios de municipios que no usan .gob.ar / .gov.ar (por ejemplo un .com.ar propio), tomados de fuentes',
      ' * oficiales (ReFeGLo del Ministerio del Interior y gba.gob.ar) y verificados: la página responde y lleva el',
      ' * nombre del municipio. Lo genera `npm run investigar -- verificar-dominios`; no editar a mano.',
      ' */',
      'export const DOMINIOS_MUNICIPALES: Record<string, string> = {',
      ...filas,
      '};',
      '',
    ].join('\n'),
  );
  esperarLinea(`Dominios municipales: ${aceptados.size} verificados, ${rechazados} rechazados (no responden o no nombran al municipio)`);
  return aceptados.size;
}
