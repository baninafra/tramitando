/** Consultas de temas, subtemas y situaciones de vida. */
import type { Ubicacion } from './jurisdicciones';
import { type FilaTarjeta, POR_PAGINA, paginacion, tarjeta } from './comun';
import { varianteMasCercana } from './jurisdicciones';

export interface FilaTema {
  id: number;
  tipo: 'tema' | 'situacion';
  slug: string;
  nombre: string;
  descripcion: string;
  icono: string | null;
  padre_id: number | null;
  orden: number;
  en_portada: number;
  cantidad_tramites: number;
}

const SQL_TEMAS = `
  SELECT t.id, t.tipo, t.slug, t.nombre, t.descripcion, t.icono, t.padre_id, t.orden, t.en_portada,
         (SELECT COUNT(DISTINCT tt.tramite_id)
            FROM tramite_temas tt
            JOIN tramites tr ON tr.id = tt.tramite_id
           WHERE (tt.tema_id = t.id
                  OR (t.padre_id IS NULL AND tt.tema_id IN (SELECT id FROM temas WHERE padre_id = t.id)))
             AND tr.estado = 'activo'
             AND EXISTS (SELECT 1 FROM variantes v WHERE v.tramite_id = tr.id AND v.estado = 'publicada')
         ) AS cantidad_tramites
    FROM temas t
   WHERE t.estado = 'activo'
   ORDER BY t.orden, t.nombre COLLATE NOCASE`;

function temaPublico(fila: FilaTema) {
  return {
    id: fila.id,
    slug: fila.slug,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    icono: fila.icono,
    orden: fila.orden,
    en_portada: fila.en_portada === 1,
    cantidad_tramites: fila.cantidad_tramites,
  };
}

export async function listarTemas(db: D1Database, soloPortada: boolean) {
  const { results } = await db.prepare(SQL_TEMAS).all<FilaTema>();
  const visibles = results.filter((fila) => !soloPortada || fila.en_portada === 1);
  const hijos = new Map<number, FilaTema[]>();
  for (const fila of results) {
    if (fila.padre_id === null) continue;
    const lista = hijos.get(fila.padre_id) ?? [];
    lista.push(fila);
    hijos.set(fila.padre_id, lista);
  }

  const temas = visibles
    .filter((fila) => fila.tipo === 'tema' && fila.padre_id === null)
    .map((fila) => ({ ...temaPublico(fila), subtemas: (hijos.get(fila.id) ?? []).map(temaPublico) }));

  const situaciones = visibles.filter((fila) => fila.tipo === 'situacion' && fila.padre_id === null).map(temaPublico);

  return { temas, situaciones };
}

export interface FilaTemaDetalle {
  id: number;
  tipo: 'tema' | 'situacion';
  slug: string;
  nombre: string;
  descripcion: string;
  icono: string | null;
  padre_id: number | null;
  padre_slug: string | null;
  padre_nombre: string | null;
  orden: number;
  en_portada: number;
}

export async function buscarTema(db: D1Database, slug: string): Promise<FilaTemaDetalle | null> {
  return db
    .prepare(
      `SELECT t.id, t.tipo, t.slug, t.nombre, t.descripcion, t.icono, t.padre_id, t.orden, t.en_portada,
              p.slug AS padre_slug, p.nombre AS padre_nombre
         FROM temas t
         LEFT JOIN temas p ON p.id = t.padre_id
        WHERE t.slug = ? AND t.estado = 'activo'`,
    )
    .bind(slug)
    .first<FilaTemaDetalle>();
}

export async function slugHistorico(db: D1Database, tipo: 'tema' | 'tramite' | 'organismo', slug: string): Promise<string | null> {
  const fila = await db
    .prepare('SELECT slug_nuevo FROM slugs_historicos WHERE tipo = ? AND slug_viejo = ?')
    .bind(tipo, slug)
    .first<{ slug_nuevo: string }>();
  return fila?.slug_nuevo ?? null;
}

export async function subtemasDe(db: D1Database, padreId: number) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.tipo, t.slug, t.nombre, t.descripcion, t.icono, t.padre_id, t.orden, t.en_portada,
              (SELECT COUNT(DISTINCT tt.tramite_id)
                 FROM tramite_temas tt
                 JOIN tramites tr ON tr.id = tt.tramite_id
                WHERE tt.tema_id = t.id
                  AND tr.estado = 'activo'
                  AND EXISTS (SELECT 1 FROM variantes v WHERE v.tramite_id = tr.id AND v.estado = 'publicada')
              ) AS cantidad_tramites
         FROM temas t
        WHERE t.padre_id = ? AND t.estado = 'activo'
        ORDER BY t.orden, t.nombre COLLATE NOCASE`,
    )
    .bind(padreId)
    .all<FilaTema>();
  return results.map(temaPublico);
}

/** Ids del tema y, si es de primer nivel, de sus subtemas. */
async function idsDelTema(db: D1Database, tema: FilaTemaDetalle): Promise<number[]> {
  const ids = [tema.id];
  const { results } = await db.prepare('SELECT id FROM temas WHERE padre_id = ?').bind(tema.id).all<{ id: number }>();
  for (const fila of results) ids.push(fila.id);
  return ids;
}

/** Condición SQL que marca los trámites con variante en la ubicación pedida. */
function condicionLocal(ubicacion: Ubicacion): { sql: string; valores: string[] } {
  if (ubicacion.municipio) {
    return {
      sql: `EXISTS (SELECT 1 FROM variantes vl WHERE vl.tramite_id = t.id AND vl.estado = 'publicada'
                     AND vl.jurisdiccion_id IN (?, ?))`,
      valores: [ubicacion.municipio.id, ubicacion.provincia?.id ?? ubicacion.municipio.id],
    };
  }
  if (ubicacion.provincia) {
    return {
      sql: `EXISTS (SELECT 1 FROM variantes vl JOIN jurisdicciones jl ON jl.id = vl.jurisdiccion_id
                    WHERE vl.tramite_id = t.id AND vl.estado = 'publicada'
                      AND (jl.id = ? OR jl.padre_id = ?))`,
      valores: [ubicacion.provincia.id, ubicacion.provincia.id],
    };
  }
  return { sql: '0', valores: [] };
}

export async function tramitesDelTema(
  db: D1Database,
  tema: FilaTemaDetalle,
  ubicacion: Ubicacion,
  pagina: number,
) {
  const ids = await idsDelTema(db, tema);
  const marcadores = ids.map(() => '?').join(', ');
  const local = condicionLocal(ubicacion);
  const filtro = `FROM tramites t
     JOIN tramite_temas tt ON tt.tramite_id = t.id
    WHERE tt.tema_id IN (${marcadores})
      AND t.estado = 'activo'
      AND EXISTS (SELECT 1 FROM variantes v WHERE v.tramite_id = t.id AND v.estado = 'publicada')`;

  const totalFila = await db
    .prepare(`SELECT COUNT(DISTINCT t.id) AS total ${filtro}`)
    .bind(...ids)
    .first<{ total: number }>();
  const total = totalFila?.total ?? 0;

  const { results } = await db
    .prepare(
      `SELECT DISTINCT t.id, t.slug, t.nombre, t.nombre_busqueda, t.resumen, t.sinonimos, t.popularidad,
              (${local.sql}) AS local
         ${filtro}
        ORDER BY local DESC, COALESCE(t.popularidad, 1000000) ASC, t.nombre COLLATE NOCASE
        LIMIT ? OFFSET ?`,
    )
    .bind(...local.valores, ...ids, POR_PAGINA, (pagina - 1) * POR_PAGINA)
    .all<FilaTarjeta & { local: number }>();

  const tramites = [];
  for (const fila of results) {
    const cercana = await varianteMasCercana(db, fila.id, ubicacion);
    tramites.push(tarjeta(fila, cercana?.fila ?? null));
  }

  return { tramites, ...paginacion(total, pagina) };
}
