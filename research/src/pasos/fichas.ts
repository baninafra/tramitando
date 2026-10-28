import { readFile } from 'node:fs/promises';
import { EntradaCatalogo } from '@tramitando/shared';
import type { ClienteApi, ItemTrabajo } from '../api.js';
import { escribirJson, esperarLinea, leerJson, listarJson } from '../archivos.js';
import type { DescargarFn } from '../crawler.js';
import { slugsDeTemas, Temario } from '../esquemas.js';
import { investigarFicha, NoEsTramite, type EntradaFicha, type Preguntar, type ResultadoFicha } from '../fichas.js';
import { rutaDatos } from '../rutas.js';

export interface OpcionesPasoFichas {
  jurisdiccion?: string;
  local?: number;
  limite?: number;
  descargar: DescargarFn;
  preguntar: Preguntar;
  api?: ClienteApi;
  subir?: boolean;
  dirCatalogo?: string;
  dirFichas?: string;
  temasPath?: string;
  promptPath?: string;
}

interface Pendiente {
  entrada: EntradaFicha;
  colaTrabajoId?: number | string;
}

export function slugificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'tramite';
}

function slugDesdeUrl(url: string): string {
  const segmentos = new URL(url).pathname.split('/').filter(Boolean);
  const ultimo = segmentos.pop() ?? 'tramite';
  let decodificado = ultimo;
  try {
    decodificado = decodeURIComponent(ultimo);
  } catch {
    // Se queda el valor crudo.
  }
  return slugificar(decodificado.replace(/\.(html?|php|aspx?)$/i, ''));
}

export function nombreArchivoFicha(slug: string, jurisdiccionId: string): string {
  return `${slug}--${jurisdiccionId}.json`;
}

async function pendientesLocales(opciones: OpcionesPasoFichas, maximo: number): Promise<Pendiente[]> {
  const dirCatalogo = opciones.dirCatalogo ?? rutaDatos('catalogo');
  const dirFichas = opciones.dirFichas ?? rutaDatos('fichas');
  const yaHechas = new Set(await listarJson(dirFichas));
  const pendientes: Pendiente[] = [];

  for (const archivo of await listarJson(dirCatalogo)) {
    const jurisdiccion = archivo.replace(/\.json$/, '');
    if (opciones.jurisdiccion && jurisdiccion !== opciones.jurisdiccion) continue;
    const entradas = EntradaCatalogo.array().parse(await leerJson(`${dirCatalogo}/${archivo}`));
    for (const entrada of entradas) {
      if (pendientes.length >= maximo) break;
      const slug = slugDesdeUrl(entrada.url);
      if (yaHechas.has(nombreArchivoFicha(slug, entrada.jurisdiccion_id))) continue;
      pendientes.push({
        entrada: {
          url: entrada.url,
          nombre_oficial: entrada.nombre_oficial,
          jurisdiccion_id: entrada.jurisdiccion_id,
          portal: entrada.portal,
          tramite_slug: slug,
        },
      });
    }
  }
  return pendientes;
}

export function desdeItemTrabajo(item: ItemTrabajo): Pendiente | null {
  const catalogo = item.catalogo ?? null;
  const variante = item.variante ?? null;
  const url = catalogo?.url ?? variante?.fuentes?.[0]?.url;
  if (!url) return null;
  const jurisdiccion = String(
    catalogo?.jurisdiccion_id ?? variante?.jurisdiccion_id ?? '',
  ).trim();
  if (!jurisdiccion) return null;

  const slugCrudo = variante?.tramite_slug ?? (typeof item.tramite_slug === 'string' ? item.tramite_slug : null);
  const slug = slugCrudo && slugCrudo.trim() ? slugificar(slugCrudo) : slugDesdeUrl(url);
  const nombre =
    String(catalogo?.nombre_oficial ?? '').trim() ||
    slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) ||
    'Trámite';

  return {
    entrada: {
      url,
      nombre_oficial: nombre,
      jurisdiccion_id: jurisdiccion,
      portal: catalogo?.portal,
      tramite_slug: slug,
      slug_fijo: variante?.tramite_slug ?? null,
    },
    colaTrabajoId: item.cola_trabajo_id,
  };
}

export async function pasoFichas(opciones: OpcionesPasoFichas): Promise<ResultadoFicha[]> {
  const dirFichas = opciones.dirFichas ?? rutaDatos('fichas');
  const temario = Temario.parse(await leerJson(opciones.temasPath ?? rutaDatos('temas.json')));
  const temas = slugsDeTemas(temario);
  const temasPadre = temario.temas.map((t) => t.slug);
  const promptFicha = await readFile(
    opciones.promptPath ?? rutaDatos('..', 'prompts', 'ficha.md'),
    'utf8',
  );

  let pendientes: Pendiente[];
  if (opciones.local !== undefined) {
    pendientes = await pendientesLocales(opciones, opciones.local);
  } else {
    if (!opciones.api) throw new Error('Sin --local hace falta configurar la API (INGEST_TOKEN)');
    const items = await opciones.api.pedirTrabajo(opciones.limite ?? 10);
    pendientes = items
      .map(desdeItemTrabajo)
      .filter((p): p is Pendiente => p !== null)
      .filter((p) => !opciones.jurisdiccion || p.entrada.jurisdiccion_id === opciones.jurisdiccion);
  }

  if (pendientes.length === 0) {
    esperarLinea('No hay fichas pendientes.');
    return [];
  }

  const resultados: ResultadoFicha[] = [];
  let indice = 0;
  for (const pendiente of pendientes) {
    indice += 1;
    const { entrada } = pendiente;
    esperarLinea(`→ ${indice}/${pendientes.length} ${entrada.nombre_oficial} (${entrada.jurisdiccion_id})`);
    try {
      const resultado = await investigarFicha(entrada, {
        descargar: opciones.descargar,
        preguntar: opciones.preguntar,
        temas,
        temasPadre,
        promptFicha,
      });
      const slug = entrada.tramite_slug && entrada.tramite_slug.length > 0
        ? slugificar(entrada.tramite_slug)
        : slugDesdeUrl(entrada.url);
      const ruta = `${dirFichas}/${nombreArchivoFicha(slug, entrada.jurisdiccion_id)}`;
      await escribirJson(ruta, resultado.borrador);
      for (const problema of resultado.chequeos) esperarLinea(`  chequeo: ${problema}`);
      if (opciones.subir) {
        if (!opciones.api) throw new Error('Para --subir hace falta configurar la API');
        if (pendiente.colaTrabajoId === undefined || pendiente.colaTrabajoId === '') {
          esperarLinea('  sin ítem de cola asociado (modo --local): queda solo en disco');
        } else {
          const subido = (await opciones.api.subirBorrador(resultado.borrador, pendiente.colaTrabajoId)) as { id?: number };
          esperarLinea('  borrador subido a la cola');
          // AUTOPUBLICAR=1: sin revisión manual, la ficha se aprueba apenas se sube (decisión del usuario).
          // Las que no pasan los chequeos (por ejemplo, sin pasos) quedan en borradores.
          if (process.env.AUTOPUBLICAR === '1' && subido?.id !== undefined) {
            if (resultado.chequeos.length === 0) {
              await opciones.api.aprobarBorrador(subido.id);
              esperarLinea('  publicada');
            } else {
              esperarLinea('  queda en borradores por los chequeos');
            }
          }
        }
      }
      esperarLinea(`  guardado ${ruta}`);
      resultados.push(resultado);
    } catch (error) {
      if (error instanceof NoEsTramite) {
        // Noticias y secciones del sitio no se publican: se sacan del catálogo para que no vuelvan a la cola.
        if (opciones.subir && opciones.api && pendiente.colaTrabajoId !== undefined && pendiente.colaTrabajoId !== '') {
          try {
            await opciones.api.descartar({ colaTrabajoId: pendiente.colaTrabajoId });
            esperarLinea(`  descartada: ${error.message}`);
          } catch (e) {
            esperarLinea(`  error: no se pudo descartar (${e instanceof Error ? e.message : String(e)})`);
          }
        } else {
          esperarLinea(`  descartada: ${error.message}`);
        }
        continue;
      }
      esperarLinea(`  error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  esperarLinea(`Listo: ${resultados.length} fichas de ${pendientes.length}`);
  return resultados;
}
