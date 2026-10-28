import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// portales.json
// ---------------------------------------------------------------------------------------------

export const EstadoPortal = z.enum(['ok', 'no_encontrado', 'requiere_js']);
export type EstadoPortal = z.infer<typeof EstadoPortal>;

export const CategoriaPortal = z.object({
  nombre: z.string().min(1),
  url: z.string().url(),
});

export const Portal = z.object({
  jurisdiccion_id: z.string().min(1),
  nombre: z.string().min(1),
  estado: EstadoPortal,
  sitio: z.string().url(),
  /** Guía o buscador oficial de trámites. null si no se encontró. */
  guia_url: z.string().url().nullable().default(null),
  listado_urls: z.array(z.string().url()).default([]),
  /** Descripción textual de cómo paginar el listado. */
  paginacion: z.string().max(500).nullable().default(null),
  /** Regex (sin barras) para reconocer URLs de fichas de trámites. */
  regex_fichas: z.string().max(500).nullable().default(null),
  categorias: z.array(CategoriaPortal).default([]),
  notas: z.string().max(500).nullable().default(null),
});
export type Portal = z.infer<typeof Portal>;

export const ArchivoPortales = z.object({
  generado_en: z.string(),
  portales: z.array(Portal),
});
export type ArchivoPortales = z.infer<typeof ArchivoPortales>;

export const SemillaPortales = z.object({
  nota: z.string().optional(),
  jurisdicciones: z.array(
    z.object({
      jurisdiccion_id: z.string().min(1),
      nombre: z.string().min(1),
      sitios: z.array(z.string().url()).min(1),
    }),
  ),
});
export type SemillaPortales = z.infer<typeof SemillaPortales>;

// ---------------------------------------------------------------------------------------------
// Respuestas de Gemini en el paso `portales`
// ---------------------------------------------------------------------------------------------

export const RespuestaIdentificarGuia = z.object({
  estado: EstadoPortal,
  guia_url: z.string().url().nullable(),
  /** Siguiente página del sitio que conviene leer para encontrar la guía. */
  siguiente_url: z.string().url().nullable().default(null),
  motivo: z.string().max(500).nullable().default(null),
});
export type RespuestaIdentificarGuia = z.infer<typeof RespuestaIdentificarGuia>;

export const RespuestaDescribirGuia = z.object({
  listado_urls: z.array(z.string().url()).default([]),
  paginacion: z.string().max(500).nullable().default(null),
  regex_fichas: z.string().max(500).nullable().default(null),
  categorias: z.array(CategoriaPortal).default([]),
  notas: z.string().max(500).nullable().default(null),
});
export type RespuestaDescribirGuia = z.infer<typeof RespuestaDescribirGuia>;

// ---------------------------------------------------------------------------------------------
// temas.json
// ---------------------------------------------------------------------------------------------

export const TemaInvestigado = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  nombre: z.string().min(2).max(60),
  descripcion: z.string().max(200),
  subtemas: z.array(
    z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      nombre: z.string().min(2).max(60),
      descripcion: z.string().max(200),
      categorias_origen: z.array(z.string()).default([]),
    }),
  ),
});
export type TemaInvestigado = z.infer<typeof TemaInvestigado>;

export const SituacionInvestigada = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  nombre: z.string().min(2).max(60),
  descripcion: z.string().max(200),
  subtemas_relacionados: z.array(z.string()).default([]),
});

export const Temario = z.object({
  portales_relevados: z
    .array(
      z.object({
        portal: z.string(),
        url: z.string().url(),
        abierto: z.boolean(),
        categorias: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  temas: z.array(TemaInvestigado),
  situaciones: z.array(SituacionInvestigada).default([]),
});
export type Temario = z.infer<typeof Temario>;

/** Slugs válidos de un temario (temas y subtemas). */
export function slugsDeTemas(temario: Temario): string[] {
  const slugs = new Set<string>();
  for (const tema of temario.temas) {
    slugs.add(tema.slug);
    for (const sub of tema.subtemas) slugs.add(sub.slug);
  }
  return [...slugs];
}

// ---------------------------------------------------------------------------------------------
// Respuestas de Gemini en `catalogo` (cuando no hay regex de fichas)
// ---------------------------------------------------------------------------------------------

export const RespuestaClasificarLinks = z.object({
  fichas: z.array(z.string().url()).default([]),
  listado: z.array(z.string().url()).default([]),
});
export type RespuestaClasificarLinks = z.infer<typeof RespuestaClasificarLinks>;

// ---------------------------------------------------------------------------------------------
// Respuestas de Gemini en `clasificar`
// ---------------------------------------------------------------------------------------------

export const RespuestaClasificarCatalogo = z.object({
  asignaciones: z.array(
    z.object({
      url: z.string().url(),
      temas: z.array(z.string()).default([]),
    }),
  ),
});
export type RespuestaClasificarCatalogo = z.infer<typeof RespuestaClasificarCatalogo>;
