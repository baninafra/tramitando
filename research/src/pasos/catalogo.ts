import { EntradaCatalogo } from '@tramitando/shared';
import type { ClienteApi } from '../api.js';
import { escribirJson, esperarLinea, leerJson } from '../archivos.js';
import { crawlearPortal, type DescargarFn, type PortalCrawlable } from '../crawler.js';
import { ArchivoPortales, RespuestaClasificarLinks, type Portal } from '../esquemas.js';
import type { Preguntar } from '../fichas.js';
import { rutaDatos } from '../rutas.js';
import type { LinkPagina } from '../texto.js';

export interface OpcionesPasoCatalogo {
  jurisdiccion?: string;
  descargar: DescargarFn;
  preguntar: Preguntar;
  api?: ClienteApi;
  subir?: boolean;
  maxPaginas?: number;
  portalesPath?: string;
  dirSalida?: string;
  /** Fuerza el navegador en todas las páginas (CLI `--render`). */
  renderizar?: boolean;
}

export function clasificadorConGemini(preguntar: Preguntar) {
  return async (links: LinkPagina[], portal: PortalCrawlable) => {
    const prompt = [
      'Sos un investigador de trámites públicos de la Argentina.',
      'Te paso links de una página de listado de una guía oficial. NO navegues.',
      'Clasificá cada URL en "fichas" (la página de un trámite concreto) o "listado" (categorías, paginación, buscadores).',
      'No inventes URLs: usá solo las que aparecen abajo.',
      '',
      `Jurisdicción: ${portal.jurisdiccion_id}`,
      `Guía: ${portal.guia_url}`,
      '',
      ...links.slice(0, 200).map((link) => `- ${link.url} :: ${link.texto.slice(0, 120)}`),
      '',
      'Respondé SOLO con JSON: {"fichas":["https://..."],"listado":["https://..."]}',
    ].join('\n');
    const respuesta = await preguntar(prompt, RespuestaClasificarLinks);
    const validas = new Set(links.map((l) => l.url));
    return {
      fichas: respuesta.fichas.filter((url) => validas.has(url)),
      listado: respuesta.listado.filter((url) => validas.has(url)),
    };
  };
}

async function leerCatalogoExistente(ruta: string): Promise<EntradaCatalogo[]> {
  try {
    const crudo = await leerJson<unknown>(ruta);
    return EntradaCatalogo.array().parse(crudo);
  } catch {
    return [];
  }
}

export async function pasoCatalogo(opciones: OpcionesPasoCatalogo): Promise<EntradaCatalogo[]> {
  const archivo = ArchivoPortales.parse(
    await leerJson(opciones.portalesPath ?? rutaDatos('portales.json')),
  );
  const portales = archivo.portales.filter(
    (p) => p.estado === 'ok' && p.guia_url && (!opciones.jurisdiccion || p.jurisdiccion_id === opciones.jurisdiccion),
  );
  if (portales.length === 0) {
    esperarLinea('No hay portales ok para recorrer. Corré primero el paso "portales".');
    return [];
  }

  const dirSalida = opciones.dirSalida ?? rutaDatos('catalogo');
  const clasificar = clasificadorConGemini(opciones.preguntar);
  const todas: EntradaCatalogo[] = [];

  for (const portal of portales as (Portal & { guia_url: string })[]) {
    esperarLinea(`→ ${portal.nombre} (${portal.jurisdiccion_id})`);
    const encontradas = await crawlearPortal(
      {
        jurisdiccion_id: portal.jurisdiccion_id,
        nombre: portal.nombre,
        guia_url: portal.guia_url,
        listado_urls: portal.listado_urls,
        regex_fichas: portal.regex_fichas,
        categorias_urls: portal.categorias.map((categoria) => categoria.url),
      },
      {
        descargar: opciones.descargar,
        maxPaginas: opciones.maxPaginas ?? 2000,
        clasificar: portal.regex_fichas ? undefined : clasificar,
        alProgreso: (mensaje) => esperarLinea(mensaje),
        renderizar: opciones.renderizar,
      },
    );

    const ruta = `${dirSalida}/${portal.jurisdiccion_id}.json`;
    const previas = await leerCatalogoExistente(ruta);
    const porUrl = new Map(previas.map((entrada) => [entrada.url, entrada]));
    for (const entrada of encontradas) porUrl.set(entrada.url, entrada);
    const catalogo = [...porUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
    await escribirJson(ruta, catalogo);
    esperarLinea(`  ${encontradas.length} fichas nuevas, ${catalogo.length} en total → ${ruta}`);
    todas.push(...encontradas);
  }

  if (opciones.subir) {
    if (!opciones.api) throw new Error('Para --subir hace falta configurar la API');
    for (let i = 0; i < todas.length; i += 500) {
      const tanda = todas.slice(i, i + 500);
      const resultado = await opciones.api.subirCatalogo(tanda);
      esperarLinea(
        `  subidas ${i + tanda.length}/${todas.length}: ${resultado.nuevas} nuevas, ${resultado.repetidas} repetidas, ${resultado.invalidas.length} inválidas`,
      );
    }
  }

  return todas;
}
