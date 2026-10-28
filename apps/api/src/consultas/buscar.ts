/** Búsqueda de texto completo sobre `tramites_fts`. */
import { type FilaTarjeta, POR_PAGINA, paginacion, tarjeta } from './comun';
import { type Ubicacion, varianteMasCercana } from './jurisdicciones';

const CARACTERES_FTS = /["*():^]/g;
const RESERVADAS = new Set(['and', 'or', 'not', 'near']);

/** Palabras que no dicen qué trámite es: se descartan para que la búsqueda en lenguaje natural funcione. */
const VACIAS = new Set(
  'a al como con cual cuales cuando de del desde donde el en es esta este hacer hago la las lo los me mi mis necesito para por puedo que quiero se sacar saco ser sin sobre su sus tengo tramite tramites un una uno y ya'.split(' '),
);

/** Sinónimos de uso común: la palabra del vecino → las que suelen usar los organismos. */
const SINONIMOS: Record<string, string[]> = {
  registro: ['licencia'], manejo: ['conducir', 'licencia'], manejar: ['conducir', 'licencia'], carnet: ['licencia', 'credencial'],
  carne: ['licencia', 'credencial'], brevet: ['licencia', 'conducir'], partida: ['acta'], acta: ['partida'],
  documento: ['dni'], dni: ['documento'], multa: ['infraccion', 'faltas'], multas: ['infracciones', 'faltas'],
  infraccion: ['multa'], patente: ['automotor'], auto: ['automotor', 'vehiculo'], moto: ['motovehiculo', 'vehiculo'],
  boleta: ['tasa'], impuesto: ['tasa'], impuestos: ['tasas'], abl: ['tasa', 'inmobiliaria'], negocio: ['comercio', 'comercial'],
  local: ['comercio', 'habilitacion'], comercio: ['habilitacion', 'comercial'], casa: ['vivienda', 'inmueble'],
  terreno: ['inmueble', 'catastro', 'lote'], obra: ['construccion', 'edificacion'], perro: ['mascota', 'zoonosis', 'castracion'],
  gato: ['mascota', 'zoonosis', 'castracion'], arbol: ['poda'], basura: ['residuos', 'recoleccion'], luz: ['alumbrado'],
  bache: ['calle', 'bacheo'], jubilacion: ['jubilaciones', 'pension'], trabajo: ['empleo'], bebe: ['nacimiento', 'recien'],
  casamiento: ['matrimonio'], casarme: ['matrimonio'], muerte: ['defuncion'], fallecimiento: ['defuncion'], cementerio: ['nicho'],
  doctor: ['salud', 'turno'], medico: ['salud', 'turno'], hospital: ['salud'], beca: ['becas'], plata: ['subsidio', 'ayuda'],
};

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Convierte el texto libre del usuario en una consulta FTS5 segura y tolerante.
 *
 * Cada palabra se limpia de la sintaxis de FTS (comillas, asteriscos, paréntesis, dos puntos,
 * circunflejo, guiones iniciales) y se busca como prefijo entre comillas: `"licen"*`. Se descartan las
 * palabras reservadas de FTS y las que no dicen nada del trámite ("quiero", "de", "sacar"), se suman
 * sinónimos comunes ("manejo" → conducir, licencia) y las palabras se unen con OR: alcanza con que
 * coincida una, y bm25 pone primero lo que coincide con más. Devuelve null si no queda ninguna palabra.
 */
export function consultaFts(texto: string): string | null {
  const limpias = sinTildes(texto)
    .toLowerCase()
    .split(/\s+/)
    .map((palabra) =>
      palabra
        .replace(CARACTERES_FTS, '')
        .replace(/^-+/, '')
        .replace(/[^\p{L}\p{N}_-]/gu, ''),
    )
    .filter((palabra) => palabra.length > 0 && /[\p{L}\p{N}]/u.test(palabra) && !RESERVADAS.has(palabra));

  // Si todo eran palabras vacías ("dni de"), se usan igual para no devolver nada.
  const utiles = limpias.filter((p) => !VACIAS.has(p));
  const base = utiles.length > 0 ? utiles : limpias;
  const unicas = [...new Set(base.flatMap((p) => [p, ...(SINONIMOS[p] ?? [])]))];
  if (unicas.length === 0) return null;
  return unicas.map((palabra) => `"${palabra}"*`).join(' OR ');
}

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

export async function buscar(
  db: D1Database,
  consulta: string,
  ubicacion: Ubicacion,
  pagina: number,
) {
  const local = condicionLocal(ubicacion);
  const filtro = `FROM tramites_fts
     JOIN tramites t ON t.id = tramites_fts.tramite_id
    WHERE tramites_fts MATCH ?
      AND t.estado = 'activo'
      AND EXISTS (SELECT 1 FROM variantes v WHERE v.tramite_id = t.id AND v.estado = 'publicada')`;

  const totalFila = await db
    .prepare(`SELECT COUNT(*) AS total ${filtro}`)
    .bind(consulta)
    .first<{ total: number }>();
  const total = totalFila?.total ?? 0;

  const { results } = await db
    .prepare(
      `SELECT t.id, t.slug, t.nombre, t.nombre_busqueda, t.resumen, t.sinonimos, t.popularidad,
              (${local.sql}) AS local
         ${filtro}
        ORDER BY local DESC,
                 bm25(tramites_fts) + COALESCE(t.popularidad, 1000) * 0.01 ASC,
                 t.nombre COLLATE NOCASE
        LIMIT ? OFFSET ?`,
    )
    .bind(...local.valores, consulta, POR_PAGINA, (pagina - 1) * POR_PAGINA)
    .all<FilaTarjeta & { local: number }>();

  const resultados = [];
  for (const fila of results) {
    const cercana = await varianteMasCercana(db, fila.id, ubicacion);
    resultados.push(tarjeta(fila, cercana?.fila ?? null));
  }

  return { resultados, ...paginacion(total, pagina) };
}
