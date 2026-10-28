/**
 * Respaldo sin búsqueda web para un municipio (cuando Gemini y DeepSeek no tienen cuota):
 * 1. prueba las direcciones oficiales típicas de una municipalidad,
 * 2. recorre el sitio encontrado con el crawler (solo dominios oficiales),
 * 3. el LLM que esté configurado (Qwen local con TRAMITANDO_LLM=qwen) decide qué links son trámites.
 */
import { EntradaCatalogo, esUrlOficial } from '@tramitando/shared';
import { esFuenteAceptada } from '../confirmados.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { esperarLinea } from '../archivos.js';
import { type ClasificadorLinks, crawlearPortal, type DescargarFn, type PortalCrawlable } from '../crawler.js';
import type { Preguntar } from '../fichas.js';
import { rutaDatos } from '../rutas.js';
import { extraerTexto, type LinkPagina } from '../texto.js';
import { z } from 'zod';
import { clasificarPorReglas, esRuido } from '../reglas.js';
import { seccionesSinCubrir, tramitesDeAreas, tramitesDeWordPress } from '../wordpress.js';

/** Abreviaturas usadas en subdominios provinciales (`<municipio>.<prov>.gob.ar`). */
const SIGLAS: Record<string, string[]> = {
  'Buenos Aires': ['gba', 'ba'],
  Córdoba: ['cba', 'cordoba'],
  'Santa Fe': ['santafe'],
  Mendoza: ['mendoza'],
  Tucumán: ['tucuman'],
  'Entre Ríos': ['entrerios'],
  Salta: ['salta'],
  Corrientes: ['corrientes'],
  Misiones: ['misiones'],
  Chaco: ['chaco'],
  'San Juan': ['sanjuan'],
  Jujuy: ['jujuy'],
  Neuquén: ['neuquen'],
  'Río Negro': ['rionegro'],
  Chubut: ['chubut'],
  'San Luis': ['sanluis'],
  'La Pampa': ['lapampa'],
  Formosa: ['formosa'],
  Catamarca: ['catamarca'],
  'La Rioja': ['larioja'],
  'Santa Cruz': ['santacruz'],
  'Santiago del Estero': ['sde', 'santiagodelestero'],
  'Tierra del Fuego, Antártida e Islas del Atlántico Sur': ['tierradelfuego', 'tdf'],
};

function compactar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Direcciones oficiales candidatas para el sitio de una municipalidad, de la más a la menos probable. */
export function candidatos(municipio: string, provincia: string): string[] {
  const n = compactar(municipio.replace(/^Municipalidad de /i, ''));
  const hosts = [
    `www.${n}.gob.ar`,
    `${n}.gob.ar`,
    `www.${n}.gov.ar`,
    `${n}.gov.ar`,
    `www.municipalidad${n}.gob.ar`,
    `www.municipalidadde${n}.gob.ar`,
    `www.municipiode${n}.gob.ar`,
    `www.mun${n}.gob.ar`,
    ...(SIGLAS[provincia] ?? [compactar(provincia)]).flatMap((s) => [`${n}.${s}.gob.ar`, `${n}.${s}.gov.ar`]),
  ];
  return [...new Set(hosts)].map((h) => `https://${h}/`).filter(esUrlOficial);
}

const RespuestaIndices = z.object({
  fichas: z.array(z.number().int()).default([]),
  listado: z.array(z.number().int()).default([]),
});

/**
 * Clasificador pensado para un modelo local chico: los links van numerados y el modelo responde
 * solo números, así escribe pocos tokens. Máximo 120 links por página.
 */
export function clasificadorPorIndices(preguntar: Preguntar): ClasificadorLinks {
  return async (links: LinkPagina[], portal: PortalCrawlable) => {
    const lista = links.slice(0, 120);
    const prompt = [
      'Clasificá los links del sitio oficial de un municipio argentino.',
      '"fichas": páginas de un trámite o servicio concreto para vecinos (licencias, habilitaciones, tasas, partidas, turnos, permisos, reclamos, certificados).',
      '"listado": páginas que agrupan trámites o servicios y conviene recorrer (secciones de trámites, guía, servicios, áreas).',
      'Ignorá noticias, agenda, turismo, redes sociales y documentos sueltos.',
      `Sitio: ${portal.guia_url}`,
      '',
      ...lista.map((l, i) => `${i + 1}. ${l.texto.slice(0, 80) || '(sin texto)'} :: ${l.url}`),
      '',
      'Respondé SOLO con un objeto JSON con los números: {"fichas":[3,7],"listado":[1]}',
    ].join('\n');
    const r = await preguntar(prompt, RespuestaIndices);
    // Lo que elija el modelo pasa igual por el filtro de ruido: los modelos chicos se confunden.
    const elegir = (ns: number[]) =>
      [...new Set(ns)]
        .map((n) => lista[n - 1])
        .filter((l): l is LinkPagina => Boolean(l) && !esRuido(l as LinkPagina))
        .map((l) => l.url);
    return { fichas: elegir(r.fichas), listado: elegir(r.listado) };
  };
}

/**
 * Reglas primero; lo dudoso lo decide el modelo chico (Qwen 2B) y, si falla, el grande (Qwen 9B).
 * `usados` cuenta cuántas páginas resolvió cada nivel, para el registro.
 */
export function clasificadorHibrido(
  chico: Preguntar,
  grande: Preguntar | undefined,
  usados = { reglas: 0, chico: 0, grande: 0 },
): ClasificadorLinks {
  const conChico = clasificadorPorIndices(chico);
  const conGrande = grande ? clasificadorPorIndices(grande) : undefined;
  return async (links, portal) => {
    const host = new URL(portal.guia_url).hostname;
    const fichas: string[] = [];
    const listado: string[] = [];
    const dudosos: LinkPagina[] = [];
    for (const l of links) {
      const c = clasificarPorReglas(l, host);
      if (c === 'ficha') fichas.push(l.url);
      else if (c === 'listado') listado.push(l.url);
      else if (c === 'dudoso') dudosos.push(l);
    }
    usados.reglas += 1;
    if (dudosos.length > 0) {
      try {
        const r = await conChico(dudosos, portal);
        fichas.push(...r.fichas);
        listado.push(...r.listado);
        usados.chico += 1;
      } catch (error) {
        if (!conGrande) throw error;
        const r = await conGrande(dudosos, portal);
        fichas.push(...r.fichas);
        listado.push(...r.listado);
        usados.grande += 1;
      }
    }
    return { fichas: [...new Set(fichas)], listado: [...new Set(listado)] };
  };
}

export interface OpcionesMunicipioLocal {
  /** Modelo grande para lo difícil (Qwen 9B): reintentos y sitios donde el chico no encontró nada. */
  preguntarFuerte?: Preguntar;
  /** Reemplaza el clasificador (tests). */
  clasificar?: ClasificadorLinks;
  /** Sitio oficial que ya encontró otro paso (Gemini): se usa en lugar de adivinar direcciones. */
  sitio?: string;
  jurisdiccion: string;
  nombre: string;
  provincia: string;
  descargar: DescargarFn;
  preguntar: Preguntar;
  maxPaginas?: number;
  renderizar?: boolean;
  /** Si se pasa, antes de descargar los candidatos se descartan los hosts que no resuelven por DNS. */
  resuelve?: (host: string) => Promise<boolean>;
  /** Sitio que figura en una fuente oficial (ReFeGLo, gba.gob.ar): se prueba antes que las direcciones adivinadas. */
  sitioConocido?: string;
  /** Fuerza el recorrido aunque el sitio sea WordPress (para comparar). */
  sinWordPress?: boolean;
}

/** Desde cuántos trámites por la API de WordPress se confía en ella y no se recorre el sitio. */
export const MINIMO_WORDPRESS = 10;

/** Devuelve cuántas entradas nuevas agregó al catálogo de la jurisdicción. */
export async function pasoMunicipioLocal(o: OpcionesMunicipioLocal): Promise<number> {
  const nombreCorto = o.nombre.replace(/^Municipalidad de /i, '');
  if (o.sitio !== undefined && !esFuenteAceptada(o.sitio)) throw new Error(`El sitio ${o.sitio} no es oficial`);
  let sitio: string | null = null;
  if (o.sitio !== undefined) {
    // Con un sitio dado (lo encontró Gemini) no se verifica con una descarga sin JavaScript: muchos sitios
    // cargan los trámites por script, y el recorrido (con --render si hace falta) es el que decide.
    sitio = o.sitio;
  } else {
    // El sitio de la fuente oficial va primero; solo si es .gob.ar/.gov.ar, porque el catálogo no acepta otros.
    const conocido = o.sitioConocido && esUrlOficial(o.sitioConocido) ? o.sitioConocido : undefined;
    let posibles = [...new Set([...(conocido ? [conocido] : []), ...candidatos(o.nombre, o.provincia)])];
    if (o.resuelve) {
      const existen = await Promise.all(posibles.map((u) => o.resuelve!(new URL(u).hostname)));
      posibles = posibles.filter((_, i) => existen[i]);
    }
    for (const url of posibles) {
      try {
        const d = await o.descargar(url);
        if (d.tipo !== 'html' || d.status >= 400) continue;
        const { titulo, links } = extraerTexto(d.cuerpo, d.url_final);
        const pareceDelMunicipio =
          compactar(titulo).includes(compactar(nombreCorto)) || compactar(d.url_final).includes(compactar(nombreCorto));
        // El de la fuente oficial no necesita llevar el nombre (p. ej. mda.gob.ar), solo tener contenido.
        if (links.length >= 5 && (pareceDelMunicipio || url === conocido)) {
          sitio = d.url_final;
          break;
        }
      } catch {
        // No existe o no es oficial: sigue con el próximo candidato.
      }
    }
  }
  if (!sitio) {
    esperarLinea(`  ${o.jurisdiccion}: no encontramos un sitio oficial`);
    return 0;
  }
  esperarLinea(`  ${o.jurisdiccion}: sitio ${sitio}`);

  const portal = { jurisdiccion_id: o.jurisdiccion, nombre: o.nombre, guia_url: sitio, listado_urls: [], regex_fichas: null };
  const usados = { reglas: 0, chico: 0, grande: 0 };
  const recorrer = (clasificar: ClasificadorLinks) =>
    crawlearPortal(portal, {
      descargar: o.descargar,
      clasificar,
      maxPaginas: o.maxPaginas ?? 40,
      renderizar: o.renderizar,
      alProgreso: (m) => esperarLinea(m),
    });
  const clasificador = o.clasificar ?? clasificadorHibrido(o.preguntar, o.preguntarFuerte, usados);
  // WordPress: la lista de páginas sale de su API en segundos, sin recorrer. Solo reemplaza al recorrido si
  // trae bastantes trámites; con pocos se recorre igual y se suman los dos, así nunca da menos que antes.
  const wp = o.sinWordPress ? null : await tramitesDeWordPress(sitio, { descargar: o.descargar }).catch(() => null);
  const deWp = (wp?.fichas ?? []).map((x) => ({ ...x, jurisdiccion_id: o.jurisdiccion, organismo: null, portal: sitio as string }));
  // La portada dice dónde están los trámites: si linkea una sección que la API no publica, hay que recorrer.
  let sinCubrir: string[] = [];
  let dePortada: typeof deWp = [];
  if (wp && deWp.length >= MINIMO_WORDPRESS) {
    try {
      const d = await o.descargar(sitio);
      const links = extraerTexto(d.cuerpo, d.url_final).links;
      sinCubrir = seccionesSinCubrir(links, new URL(sitio).hostname, wp.urls);
      // Trámites que la portada linkea y la API no tiene (p. ej. el sistema de pago de tasas): se suman sin recorrer.
      const enApi = new Set(deWp.map((x) => x.url.replace(/\/$/, '')));
      dePortada = links
        .filter((l) => !enApi.has(l.url.replace(/\/$/, '')) && l.texto.length >= 3 && clasificarPorReglas(l, new URL(l.url).hostname) === 'ficha')
        .filter((l) => new URL(l.url).hostname.replace(/^www\./, '') === new URL(sitio as string).hostname.replace(/^www\./, ''))
        .map((l) => ({ url: l.url, nombre_oficial: l.texto.slice(0, 300), jurisdiccion_id: o.jurisdiccion, organismo: null, portal: sitio as string }));
    } catch {
      sinCubrir = ['(portada)'];
    }
  }
  let entradas: Omit<EntradaCatalogo, 'temas_sugeridos'>[];
  if (deWp.length >= MINIMO_WORDPRESS && !sinCubrir.length) {
    // Trámites que cuelgan de páginas de área ("Registro Civil", "Catastro") y que la API no publica sueltos.
    const conocidas = new Set([...deWp, ...dePortada].map((x) => x.url));
    const deAreas = (await tramitesDeAreas(wp!.links, conocidas, o.descargar).catch(() => [])).map((x) => ({
      ...x, jurisdiccion_id: o.jurisdiccion, organismo: null, portal: sitio as string,
    }));
    esperarLinea(`  ${o.jurisdiccion}: WordPress, ${wp!.titulos} páginas por la API → ${deWp.length} trámites + ${dePortada.length} de la portada + ${deAreas.length} de páginas de área, sin IA`);
    entradas = [...deWp, ...dePortada, ...deAreas];
  } else {
    if (wp) esperarLinea(`  ${o.jurisdiccion}: WordPress con ${deWp.length} trámites por la API (${wp.titulos} páginas)${sinCubrir.length ? `, la API no publica ${sinCubrir.join(' ')}` : ''}; recorro el sitio igual`);
    entradas = await recorrer(clasificador);
    // Si con reglas + modelo chico no salió nada, el sitio es difícil: segunda pasada con el grande.
    if (entradas.length === 0 && o.preguntarFuerte && !o.clasificar) {
      esperarLinea(`  ${o.jurisdiccion}: sin trámites con el modelo chico, pruebo con el grande`);
      entradas = await recorrer(clasificadorPorIndices(o.preguntarFuerte));
      usados.grande += 1;
    }
    entradas = [...entradas, ...deWp];
  }
  esperarLinea(`  ${o.jurisdiccion}: páginas por reglas ${usados.reglas}, Qwen 2B ${usados.chico}, Qwen 9B ${usados.grande}`);

  const destino = rutaDatos('catalogo', `${o.jurisdiccion}.json`);
  const previas: EntradaCatalogo[] = existsSync(destino) ? JSON.parse(readFileSync(destino, 'utf8')) : [];
  const urls = new Set(previas.map((e) => e.url));
  // Sin la clave temas_sugeridos: así `clasificar` las toma como pendientes.
  const nuevas = entradas
    .map(({ temas_sugeridos: _, ...e }: Omit<EntradaCatalogo, 'temas_sugeridos'> & { temas_sugeridos?: string[] }) => ({ ...e, portal: sitio as string }))
    .filter((e) => EntradaCatalogo.safeParse(e).success && !urls.has(e.url) && urls.add(e.url));
  writeFileSync(destino, JSON.stringify([...previas, ...nuevas], null, 2));
  esperarLinea(`  ${o.jurisdiccion}: ${nuevas.length} trámites nuevos`);
  return nuevas.length;
}
