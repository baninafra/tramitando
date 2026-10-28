import { readFile } from 'node:fs/promises';
import { escribirJson, esperarLinea, leerJson } from '../archivos.js';
import type { DescargarFn } from '../crawler.js';
import { ArchivoPortales, Temario } from '../esquemas.js';
import type { Preguntar } from '../fichas.js';
import { rutaDatos } from '../rutas.js';
import { extraerTexto } from '../texto.js';

export interface OpcionesPasoTemas {
  jurisdiccion?: string;
  descargar: DescargarFn;
  preguntar: Preguntar;
  portalesPath?: string;
  promptPath?: string;
  salidaPath?: string;
  maxPaginas?: number;
}

export async function pasoTemas(opciones: OpcionesPasoTemas) {
  const archivo = ArchivoPortales.parse(
    await leerJson(opciones.portalesPath ?? rutaDatos('portales.json')),
  );
  const portales = archivo.portales.filter(
    (p) => p.estado === 'ok' && (!opciones.jurisdiccion || p.jurisdiccion_id === opciones.jurisdiccion),
  );
  if (portales.length === 0) throw new Error('No hay portales ok. Corré primero el paso "portales".');

  const urls = new Set<string>();
  for (const portal of portales) {
    for (const categoria of portal.categorias) urls.add(categoria.url);
  }
  if (urls.size === 0) {
    for (const portal of portales) {
      for (const url of portal.listado_urls) urls.add(url);
      if (portal.guia_url) urls.add(portal.guia_url);
    }
  }

  const maxPaginas = opciones.maxPaginas ?? 40;
  const partes: string[] = [];
  let leidas = 0;
  for (const url of urls) {
    if (leidas >= maxPaginas) break;
    esperarLinea(`  descargando ${url}`);
    try {
      const descarga = await opciones.descargar(url);
      if (descarga.tipo === 'pdf' || descarga.tipo === 'otro') continue;
      const texto =
        descarga.tipo === 'html'
          ? extraerTexto(descarga.cuerpo, descarga.url_final, { maxTexto: 10_000 }).texto
          : descarga.cuerpo.slice(0, 10_000);
      partes.push(`### ${descarga.url_final}`, texto, '');
      leidas += 1;
    } catch (error) {
      esperarLinea(`  salteada: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (partes.length === 0) throw new Error('No se pudo descargar ninguna página de categorías');

  const plantilla = await readFile(opciones.promptPath ?? rutaDatos('..', 'prompts', 'temas.md'), 'utf8');
  const prompt = [
    plantilla.trim(),
    '',
    '# Páginas oficiales de categorías ya descargadas',
    'Usá solo el contenido de abajo. No navegues ni inventes categorías.',
    '',
    ...partes,
    '',
    'Respondé SOLO con el JSON pedido, sin texto alrededor.',
  ].join('\n');

  esperarLinea('  pidiendo la taxonomía a Gemini…');
  const temario = await opciones.preguntar(prompt, Temario);
  const salida = opciones.salidaPath ?? rutaDatos('temas.json');
  await escribirJson(salida, temario);
  esperarLinea(
    `Guardado ${salida}: ${temario.temas.length} temas, ${temario.situaciones.length} situaciones`,
  );
  return temario;
}
