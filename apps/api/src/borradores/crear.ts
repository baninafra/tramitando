/**
 * Creación de borradores a partir de lo que produce la investigación.
 *
 * Reglas (ver docs/arquitectura.md):
 * - Si ya hay una variante publicada para el trámite y la jurisdicción, el borrador es una
 *   `actualizacion` y guarda un diff campo por campo contra la versión publicada.
 * - Si no, es una `ficha_nueva`.
 * - Los temas propuestos generan un borrador `tema_nuevo` y, si el slug no existe, un tema en
 *   estado `propuesto`.
 * - Todo se escribe en un único `DB.batch`; el borrador no se publica.
 */
import {
  BorradorTema,
  chequearBorrador,
  type BorradorFicha,
  type ContenidoFicha,
  type Costo,
  type OficinaEntrada,
} from '@tramitando/shared';
import type { Env } from '../env';

export interface DiferenciaCampo {
  antes: unknown;
  despues: unknown;
}

export type DiffBorrador = Record<string, DiferenciaCampo>;

export interface OpcionesCrearBorrador {
  colaTrabajoId: number;
  borrador: BorradorFicha;
  ahora?: Date;
}

export interface ResultadoCrearBorrador {
  id: number;
  tipo: 'ficha_nueva' | 'actualizacion';
  diff: DiffBorrador | null;
  chequeos: string[];
  temasNuevos: number[];
}

interface FilaItemCola {
  id: number;
  catalogo_id: number | null;
  variante_id: number | null;
}

interface FilaVariante {
  id: number;
  tramite_id: number;
  jurisdiccion_id: string;
  organismo_id: number | null;
  contenido: string;
  tramite_slug: string;
  tramite_nombre: string;
  tramite_nombre_busqueda: string;
  tramite_resumen: string;
  tramite_sinonimos: string;
}

interface FilaCosto {
  modalidad: string;
  monto_centavos: number | null;
  gratis: number;
  vigente_desde: string | null;
  nota: string | null;
  fuente_url: string | null;
}

interface FilaOficina {
  nombre: string;
  direccion: string;
  localidad: string;
  horario: string | null;
  fuente_url: string | null;
}

interface FilaFuente {
  url: string;
  titulo: string | null;
  bloque: string;
}

interface FilaTema {
  slug: string;
  principal: number;
}

interface DatosAnteriores {
  tramite: {
    slug: string;
    nombre: string;
    nombre_busqueda: string;
    resumen: string;
    sinonimos: string[];
    temas: string[];
  };
  contenido: unknown;
  costos: Costo[];
  oficinas: unknown[];
  fuentes: unknown[];
}

function parsearJson<T>(texto: string | null, respaldo: T): T {
  if (!texto) return respaldo;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return respaldo;
  }
}

function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    const claves = Object.keys(objeto).sort();
    return `{${claves.map((clave) => `${JSON.stringify(clave)}:${canonico(objeto[clave])}`).join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

function normalizarFuentes(fuentes: { url: string; titulo: string | null; bloques: string[] }[]) {
  return fuentes
    .map((fuente) => ({
      url: fuente.url,
      titulo: fuente.titulo,
      bloques: [...new Set(fuente.bloques)].sort(),
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

async function leerAnteriores(db: D1Database, variante: FilaVariante): Promise<DatosAnteriores> {
  const [costos, oficinas, fuentes, temas] = await Promise.all([
    db
      .prepare(
        `SELECT c.modalidad, c.monto_centavos, c.gratis, c.vigente_desde, c.nota, f.url AS fuente_url
         FROM costos c LEFT JOIN fuentes f ON f.id = c.fuente_id
         WHERE c.variante_id = ?
         ORDER BY c.orden, c.id`,
      )
      .bind(variante.id)
      .all<FilaCosto>(),
    variante.organismo_id === null
      ? Promise.resolve({ results: [] as FilaOficina[] })
      : db
          .prepare(
            `SELECT o.nombre, o.direccion, o.localidad, o.horario, f.url AS fuente_url
             FROM oficinas o LEFT JOIN fuentes f ON f.id = o.fuente_id
             WHERE o.organismo_id = ? AND o.jurisdiccion_id = ?
             ORDER BY o.id`,
          )
          .bind(variante.organismo_id, variante.jurisdiccion_id)
          .all<FilaOficina>(),
    db
      .prepare(
        `SELECT f.url, f.titulo, vf.bloque
         FROM variante_fuentes vf INNER JOIN fuentes f ON f.id = vf.fuente_id
         WHERE vf.variante_id = ?
         ORDER BY f.id, vf.bloque`,
      )
      .bind(variante.id)
      .all<FilaFuente>(),
    db
      .prepare(
        `SELECT t.slug, tt.principal
         FROM tramite_temas tt INNER JOIN temas t ON t.id = tt.tema_id
         WHERE tt.tramite_id = ?
         ORDER BY tt.principal DESC, t.slug`,
      )
      .bind(variante.tramite_id)
      .all<FilaTema>(),
  ]);

  const mapaFuentes = new Map<string, { url: string; titulo: string | null; bloques: string[] }>();
  for (const fila of fuentes.results) {
    const actual = mapaFuentes.get(fila.url);
    if (actual) {
      actual.bloques.push(fila.bloque);
    } else {
      mapaFuentes.set(fila.url, { url: fila.url, titulo: fila.titulo, bloques: [fila.bloque] });
    }
  }

  return {
    tramite: {
      slug: variante.tramite_slug,
      nombre: variante.tramite_nombre,
      nombre_busqueda: variante.tramite_nombre_busqueda,
      resumen: variante.tramite_resumen,
      sinonimos: parsearJson<string[]>(variante.tramite_sinonimos, []),
      temas: temas.results.map((fila) => fila.slug),
    },
    contenido: parsearJson<ContenidoFicha | null>(variante.contenido, null),
    costos: costos.results.map((fila) => ({
      modalidad: fila.modalidad,
      gratis: fila.gratis === 1,
      monto_centavos: fila.monto_centavos,
      vigente_desde: fila.vigente_desde,
      nota: fila.nota,
      fuente_url: fila.fuente_url ?? '',
    })),
    oficinas: oficinas.results.map((fila) => ({
      nombre: fila.nombre,
      direccion: fila.direccion,
      localidad: fila.localidad,
      horario: fila.horario,
      fuente_url: fila.fuente_url,
    })),
    fuentes: normalizarFuentes(
      [...mapaFuentes.values()].map((fuente) => ({
        url: fuente.url,
        titulo: fuente.titulo,
        bloques: fuente.bloques,
      })),
    ),
  };
}

function calcularDiff(borrador: BorradorFicha, anteriores: DatosAnteriores): DiffBorrador {
  const diff: DiffBorrador = {};
  const comparar = (campo: string, antes: unknown, despues: unknown) => {
    if (canonico(antes) !== canonico(despues)) diff[campo] = { antes, despues };
  };

  const tramiteDespues = {
    slug: borrador.tramite.slug,
    nombre: borrador.tramite.nombre,
    nombre_busqueda: borrador.tramite.nombre_busqueda,
    resumen: borrador.tramite.resumen,
    sinonimos: borrador.tramite.sinonimos,
    temas: borrador.tramite.temas,
  };
  comparar('tramite', anteriores.tramite, tramiteDespues);
  comparar('contenido', anteriores.contenido, borrador.contenido);

  const costosDespues = [...borrador.costos].sort((a, b) => canonico(a).localeCompare(canonico(b)));
  const costosAntes = [...anteriores.costos].sort((a, b) => canonico(a).localeCompare(canonico(b)));
  comparar('costos', costosAntes, costosDespues);

  const oficinasDespues = [...borrador.oficinas].sort((a, b) => canonico(a).localeCompare(canonico(b)));
  const oficinasAntes = [...anteriores.oficinas].sort((a, b) => canonico(a).localeCompare(canonico(b)));
  comparar('oficinas', oficinasAntes, oficinasDespues);

  const fuentesDespues = normalizarFuentes(
    borrador.fuentes.map((fuente) => ({ url: fuente.url, titulo: fuente.titulo, bloques: fuente.bloques })),
  );
  comparar('fuentes', anteriores.fuentes, fuentesDespues);

  return diff;
}

interface TemaPropuestoPreparado {
  tema: BorradorTema;
  padreId: number | null;
  existe: boolean;
}

async function prepararTemasPropuestos(db: D1Database, borrador: BorradorFicha): Promise<TemaPropuestoPreparado[]> {
  const preparados: TemaPropuestoPreparado[] = [];

  for (const propuesto of borrador.tramite.temas_propuestos) {
    const tema = BorradorTema.safeParse({
      slug: propuesto.slug,
      nombre: propuesto.nombre,
      descripcion: '',
      tipo: 'tema',
      padre: propuesto.padre,
    });
    if (!tema.success) continue;

    const existente = await db.prepare('SELECT id FROM temas WHERE slug = ?').bind(tema.data.slug).first<{ id: number }>();
    let padreId: number | null = null;
    if (tema.data.padre) {
      const padre = await db.prepare('SELECT id FROM temas WHERE slug = ?').bind(tema.data.padre).first<{ id: number }>();
      padreId = padre?.id ?? null;
    }

    preparados.push({ tema: tema.data, padreId, existe: existente !== null });
  }

  return preparados;
}

/**
 * Crea el borrador (y los borradores de temas) y cierra el ítem de la cola.
 * Devuelve null si el ítem de la cola no existe.
 */
export async function crearBorrador(
  env: Env,
  opciones: OpcionesCrearBorrador,
): Promise<ResultadoCrearBorrador | null> {
  const ahora = opciones.ahora ?? new Date();
  const ahoraIso = ahora.toISOString();

  const item = await env.DB.prepare('SELECT id, catalogo_id, variante_id FROM cola_trabajo WHERE id = ?')
    .bind(opciones.colaTrabajoId)
    .first<FilaItemCola>();
  if (!item) return null;

  const variante = await env.DB.prepare(
    `SELECT v.id, v.tramite_id, v.jurisdiccion_id, v.organismo_id, v.contenido,
            t.slug AS tramite_slug, t.nombre AS tramite_nombre,
            t.nombre_busqueda AS tramite_nombre_busqueda, t.resumen AS tramite_resumen,
            t.sinonimos AS tramite_sinonimos
     FROM variantes v INNER JOIN tramites t ON t.id = v.tramite_id
     WHERE t.slug = ? AND v.jurisdiccion_id = ? AND v.estado = 'publicada'
     LIMIT 1`,
  )
    .bind(opciones.borrador.tramite.slug, opciones.borrador.jurisdiccion_id)
    .first<FilaVariante>();

  let anteriores: DatosAnteriores | null = null;
  if (variante) anteriores = await leerAnteriores(env.DB, variante);

  const tipo = anteriores ? 'actualizacion' : 'ficha_nueva';
  const diff = anteriores ? calcularDiff(opciones.borrador, anteriores) : null;
  const chequeos = chequearBorrador(
    opciones.borrador,
    anteriores ? { costos: anteriores.costos } : undefined,
  );

  const temasPropuestos = await prepararTemasPropuestos(env.DB, opciones.borrador);

  const sentencias: D1PreparedStatement[] = [];
  const indicesTemasNuevos: number[] = [];

  sentencias.push(
    env.DB.prepare(
      `INSERT INTO borradores (tipo, origen, catalogo_id, variante_id, payload, diff, chequeos)
       VALUES (?, 'ia', ?, ?, ?, ?, ?)`,
    ).bind(
      tipo,
      item.catalogo_id,
      anteriores ? variante?.id ?? null : null,
      JSON.stringify(opciones.borrador),
      diff === null ? null : JSON.stringify(diff),
      JSON.stringify(chequeos),
    ),
  );

  for (const propuesto of temasPropuestos) {
    if (!propuesto.existe) {
      sentencias.push(
        env.DB.prepare(
          `INSERT INTO temas (tipo, slug, nombre, descripcion, padre_id, estado)
           VALUES ('tema', ?, ?, '', ?, 'propuesto')`,
        ).bind(propuesto.tema.slug, propuesto.tema.nombre, propuesto.padreId),
      );
    }

    indicesTemasNuevos.push(sentencias.length);
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO borradores (tipo, origen, catalogo_id, variante_id, payload, diff, chequeos)
         VALUES ('tema_nuevo', 'ia', ?, NULL, ?, NULL, '[]')`,
      ).bind(item.catalogo_id, JSON.stringify(propuesto.tema)),
    );
  }

  if (item.catalogo_id !== null) {
    sentencias.push(
      env.DB.prepare("UPDATE catalogo SET estado = 'en_revision', actualizado_en = ? WHERE id = ?").bind(
        ahoraIso,
        item.catalogo_id,
      ),
    );
  }

  sentencias.push(env.DB.prepare('UPDATE cola_trabajo SET cerrado_en = ? WHERE id = ?').bind(ahoraIso, item.id));

  const resultados = await env.DB.batch(sentencias);
  const id = resultados[0]?.meta.last_row_id ?? 0;
  const temasNuevos = indicesTemasNuevos
    .map((indice) => resultados[indice]?.meta.last_row_id ?? 0)
    .filter((temaId) => temaId > 0);

  return { id, tipo, diff, chequeos, temasNuevos };
}
