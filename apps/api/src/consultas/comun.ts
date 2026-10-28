/** Utilidades compartidas por las consultas de la API pública. */
import { BLOQUES } from '@tramitando/shared';

/** Cabecera de caché de todas las respuestas públicas de lectura. */
export const CACHE_PUBLICA = 'public, max-age=300, s-maxage=3600';

/** Cantidad de fichas o trámites por página en los listados. */
export const POR_PAGINA = 24;

export type Nivel = 'nacion' | 'provincia' | 'municipio';

export interface FilaJurisdiccion {
  id: string;
  nivel: Nivel;
  nombre: string;
  slug: string;
  padre_id: string | null;
  georef_id: string | null;
  lat: number | null;
  lng: number | null;
}

export interface JurisdiccionPublica {
  id: string;
  nivel: Nivel;
  nombre: string;
  slug: string;
  lat: number | null;
  lng: number | null;
}

/** Fila de jurisdicción con los datos del padre ya unidos. */
export interface FilaJurisdiccionConPadre {
  id: string;
  nivel: Nivel;
  nombre: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  padre_id: string | null;
  padre_nivel: Nivel | null;
  padre_nombre: string | null;
  padre_slug: string | null;
}

export function jurisdiccionConPadre(fila: FilaJurisdiccionConPadre) {
  return {
    id: fila.id,
    nivel: fila.nivel,
    nombre: fila.nombre,
    slug: fila.slug,
    lat: fila.lat,
    lng: fila.lng,
    padre:
      fila.padre_id && fila.padre_slug && fila.padre_nombre && fila.padre_nivel
        ? { id: fila.padre_id, nivel: fila.padre_nivel, nombre: fila.padre_nombre, slug: fila.padre_slug }
        : null,
  };
}

/** `$ 12.500` (punto de miles, coma decimal solo si hay centavos). */
export function formatearMonto(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const resto = abs % 100;
  const miles = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimales = resto === 0 ? '' : `,${resto.toString().padStart(2, '0')}`;
  return `$ ${signo}${miles}${decimales}`;
}

export function paginacion(total: number, pagina: number) {
  return {
    total,
    pagina,
    por_pagina: POR_PAGINA,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
  };
}

export function leerJson<T>(texto: string): T {
  return JSON.parse(texto) as T;
}

/** Objeto con los ocho bloques de la ficha, cada uno con su lista de fuentes. */
export function fuentesVacias(): Record<string, unknown[]> {
  return Object.fromEntries(BLOQUES.map((bloque) => [bloque, []]));
}

export interface FilaTarjeta {
  id: number;
  slug: string;
  nombre: string;
  nombre_busqueda: string;
  resumen: string;
  sinonimos: string;
  popularidad: number | null;
}

export interface FilaVarianteTarjeta {
  variante_id: number;
  verificacion: 'verificado' | 'revisar';
  actualizado_en: string;
  juris_id: string;
  juris_nivel: Nivel;
  juris_nombre: string;
  juris_slug: string;
  org_id: number | null;
  org_slug: string | null;
  org_nombre: string | null;
  org_sigla: string | null;
}

export interface TarjetaTramite {
  id: number;
  slug: string;
  nombre: string;
  nombre_busqueda: string;
  resumen: string;
  sinonimos: string[];
  popularidad: number | null;
  variante: {
    id: number;
    jurisdiccion: { id: string; nivel: Nivel; nombre: string; slug: string };
    organismo: { id: number; slug: string; nombre: string; sigla: string | null } | null;
    verificacion: 'verificado' | 'revisar';
    actualizado_en: string;
  } | null;
}

export function tarjeta(tramite: FilaTarjeta, variante: FilaVarianteTarjeta | null): TarjetaTramite {
  return {
    id: tramite.id,
    slug: tramite.slug,
    nombre: tramite.nombre,
    nombre_busqueda: tramite.nombre_busqueda,
    resumen: tramite.resumen,
    sinonimos: leerJson<string[]>(tramite.sinonimos),
    popularidad: tramite.popularidad,
    variante: variante
      ? {
          id: variante.variante_id,
          jurisdiccion: {
            id: variante.juris_id,
            nivel: variante.juris_nivel,
            nombre: variante.juris_nombre,
            slug: variante.juris_slug,
          },
          organismo:
            variante.org_id !== null && variante.org_slug && variante.org_nombre
              ? { id: variante.org_id, slug: variante.org_slug, nombre: variante.org_nombre, sigla: variante.org_sigla }
              : null,
          verificacion: variante.verificacion,
          actualizado_en: variante.actualizado_en,
        }
      : null,
  };
}
