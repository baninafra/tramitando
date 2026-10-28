/** Ficha publicada más cercana a la ubicación pedida. */
import { BLOQUES } from '@tramitando/shared';
import { type FilaVarianteTarjeta, type Nivel, formatearMonto, fuentesVacias, leerJson } from './comun';
import { type Ubicacion, varianteMasCercana } from './jurisdicciones';
import { temasDeTramite, tramitePublico, type FilaTramite } from './tramites';

export interface FilaOrganismo {
  id: number;
  slug: string;
  nombre: string;
  sigla: string | null;
  descripcion: string;
  web: string | null;
  jurisdiccion_id: string;
  juris_nivel: Nivel;
  juris_nombre: string;
  juris_slug: string;
}

export interface FilaCosto {
  modalidad: string;
  monto_centavos: number | null;
  gratis: number;
  vigente_desde: string | null;
  nota: string | null;
  fuente_url: string | null;
}

export interface FilaFuenteDeBloque {
  bloque: string;
  id: number;
  url: string;
  titulo: string | null;
  consultada_en: string | null;
}

export interface FilaOficina {
  id: number;
  nombre: string;
  direccion: string;
  localidad: string;
  horario: string | null;
  lat: number | null;
  lng: number | null;
  fuente_url: string | null;
}

async function organismoDe(db: D1Database, organismoId: number): Promise<FilaOrganismo | null> {
  return db
    .prepare(
      `SELECT o.id, o.slug, o.nombre, o.sigla, o.descripcion, o.web, o.jurisdiccion_id,
              j.nivel AS juris_nivel, j.nombre AS juris_nombre, j.slug AS juris_slug
         FROM organismos o
         JOIN jurisdicciones j ON j.id = o.jurisdiccion_id
        WHERE o.id = ?`,
    )
    .bind(organismoId)
    .first<FilaOrganismo>();
}

async function costosDe(db: D1Database, varianteId: number) {
  const { results } = await db
    .prepare(
      `SELECT c.modalidad, c.monto_centavos, c.gratis, c.vigente_desde, c.nota, f.url AS fuente_url
         FROM costos c
         LEFT JOIN fuentes f ON f.id = c.fuente_id
        WHERE c.variante_id = ?
        ORDER BY c.orden, c.id`,
    )
    .bind(varianteId)
    .all<FilaCosto>();
  return results.map((fila) => ({
    modalidad: fila.modalidad,
    gratis: fila.gratis === 1,
    monto_centavos: fila.gratis === 1 ? null : fila.monto_centavos,
    monto_texto: fila.gratis === 1 ? 'Gratis' : formatearMonto(fila.monto_centavos ?? 0),
    vigente_desde: fila.vigente_desde,
    nota: fila.nota,
    fuente_url: fila.fuente_url,
  }));
}

async function fuentesDe(db: D1Database, varianteId: number) {
  const { results } = await db
    .prepare(
      `SELECT vf.bloque, f.id, f.url, f.titulo, COALESCE(f.ultimo_chequeo, f.creado_en) AS consultada_en
         FROM variante_fuentes vf
         JOIN fuentes f ON f.id = vf.fuente_id
        WHERE vf.variante_id = ?
        ORDER BY f.id`,
    )
    .bind(varianteId)
    .all<FilaFuenteDeBloque>();

  const agrupadas = fuentesVacias();
  for (const fila of results) {
    const lista = agrupadas[fila.bloque];
    if (!lista) continue;
    lista.push({ id: fila.id, url: fila.url, titulo: fila.titulo, consultada_en: fila.consultada_en });
  }
  const ordenadas: Record<string, unknown[]> = {};
  for (const bloque of BLOQUES) ordenadas[bloque] = agrupadas[bloque] ?? [];
  return ordenadas;
}

async function oficinasDe(db: D1Database, organismoId: number | null, jurisdiccionId: string) {
  if (organismoId === null) return [];
  const { results } = await db
    .prepare(
      `SELECT o.id, o.nombre, o.direccion, o.localidad, o.horario, o.lat, o.lng, f.url AS fuente_url
         FROM oficinas o
         LEFT JOIN fuentes f ON f.id = o.fuente_id
        WHERE o.organismo_id = ? AND o.jurisdiccion_id = ?
        ORDER BY o.localidad COLLATE NOCASE, o.nombre COLLATE NOCASE`,
    )
    .bind(organismoId, jurisdiccionId)
    .all<FilaOficina>();
  return results;
}

export interface FichaEncontrada {
  fila: FilaVarianteTarjeta;
  nivel: Nivel;
}

/**
 * Elige la variante publicada más cercana. Devuelve null si no hay ninguna en ningún nivel.
 */
export async function varianteDeFicha(db: D1Database, tramiteId: number, ubicacion: Ubicacion): Promise<FichaEncontrada | null> {
  return varianteMasCercana(db, tramiteId, ubicacion);
}

/** Contenido completo de la ficha. */
export async function armarFicha(
  db: D1Database,
  tramite: FilaTramite,
  encontrada: FichaEncontrada,
  ubicacion: Ubicacion,
) {
  const { fila, nivel } = encontrada;
  const organismo = fila.org_id !== null ? await organismoDe(db, fila.org_id) : null;
  const [costos, fuentes, oficinas, temas] = await Promise.all([
    costosDe(db, fila.variante_id),
    fuentesDe(db, fila.variante_id),
    oficinasDe(db, fila.org_id, fila.juris_id),
    temasDeTramite(db, tramite.id),
  ]);

  const contenido = await db
    .prepare('SELECT contenido, verificacion, verificado_en, proxima_revision, actualizado_en, version FROM variantes WHERE id = ?')
    .bind(fila.variante_id)
    .first<{
      contenido: string;
      verificacion: 'verificado' | 'revisar';
      verificado_en: string;
      proxima_revision: string;
      actualizado_en: string;
      version: number;
    }>();

  const heredadaDe = nivel === ubicacion.solicitada ? null : nivel;

  return {
    tramite: tramitePublico(tramite),
    temas,
    variante: {
      id: fila.variante_id,
      jurisdiccion: {
        id: fila.juris_id,
        nivel: fila.juris_nivel,
        nombre: fila.juris_nombre,
        slug: fila.juris_slug,
      },
      organismo: organismo
        ? {
            id: organismo.id,
            slug: organismo.slug,
            nombre: organismo.nombre,
            sigla: organismo.sigla,
            descripcion: organismo.descripcion,
            web: organismo.web,
            jurisdiccion: {
              id: organismo.jurisdiccion_id,
              nivel: organismo.juris_nivel,
              nombre: organismo.juris_nombre,
              slug: organismo.juris_slug,
            },
          }
        : null,
      contenido: contenido ? leerJson(contenido.contenido) : null,
      costos,
      fuentes,
      oficinas,
      verificacion: contenido?.verificacion ?? fila.verificacion,
      verificado_en: contenido?.verificado_en ?? null,
      proxima_revision: contenido?.proxima_revision ?? null,
      actualizado_en: contenido?.actualizado_en ?? fila.actualizado_en,
      version: contenido?.version ?? null,
    },
    heredada_de: heredadaDe,
    indexable: heredadaDe === null,
  };
}
