/**
 * Saca del catálogo lo que no es un trámite: noticias, fechas sueltas, páginas de error, restos de código,
 * páginas institucionales. Lo que nombra un trámite (licencia, habilitación, tasa…) se queda aunque parezca
 * noticia. El filtro de ruido del recorrido no se usa: saca trámites reales ("taxi", "colectivo", "admin").
 * Con `sinTema` también saca lo que quedó sin tema después de clasificar y no nombra ningún trámite.
 */
import { esperarLinea, leerJson, listarJson, escribirJson } from '../archivos.js';
import { rutaDatos } from '../rutas.js';

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Palabras que hacen que una entrada se quede siempre: nombra un trámite o servicio concreto. */
const NOMBRA_TRAMITE =
  /(tramite|licencia|habilitacion|tasa|certificado|permiso|inscripcion|reinscripcion|turno|solicitud|registro|libre deuda|reclamo|subsidio|beca|exencion|eximicion|plan de pago|moratoria|patente|castracion|partida|constancia|denuncia|declaracion jurada|carnet|credencial|renovacion|duplicado|pago|boleta|formulario|requisito|autorizacion|matricula|alta de|baja de|cambio de|transferencia|solicit|presentar|presentacion de|consult|oblea|tramitar|pedido de|pedir|acceso a la informacion|reserva de|adhesion|obtener|obtencion|gestionar|calendario|vencimiento|actualizacion|empadronamiento|tenencia|recepcion de)/;

/** Titulares de noticias: verbo de acción al principio o frases de crónica. */
const NOTICIA =
  /^(avanza|avanzan|continua|continuan|comenzo|comenzaron|finalizo|finalizaron|se (realiz|intensific|coloc|reactiv|inaugur|entreg|firm|llev|desarroll|present|lanz|celebr|reun|abrio|complet|renov|instal|trabaj|construy|reparo|refacc)|inaugur|celebr|presentamos|mejoramos|lanzamos|recibi|particip|visit|reunion|primera reunion|el intendente|la intendenta|el dem |la municipalidad (entrego|realizo|recibio|participo|firmo)|el municipio (entrego|realizo|recibio|participo|firmo)|gran |exitos|nueva edicion|nuevo record|con (gran|exito)|ultimos dias|ya se|hoy |este (lunes|martes|miercoles|jueves|viernes|sabado|domingo)|feliz |dia (del|de la|internacional|mundial))/;

/** Títulos que no son nada: fechas, errores, menús, restos de HTML o CSS. */
const BASURA =
  /^(\d{1,2}( de)? (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(,? \d{4})?|(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|[\d\s/]+|inicio|home|ver|ver mas|leer mas|seguir leyendo|downloads?|descargas|comunicados|novedades|noticias|blog|contacto|mapa del sitio|buscar|menu|saltar al contenido|ir al contenido|.{0,2})$|pagina no encontrada|no se encontro la pagina|error 404|^404|imunify|bot-check|width=|height=|srcset|class=|\{[^}]*\}|^https?:|@gmail|lorem ipsum|too many requests|access denied|forbidden|just a moment|acceso denegado/;

/** Rutas de noticias o listados de blog. */
const RUTA_NOTICIA = /\/(20\d{2})\/\d{2}\/|\/page\/\d+|[?&](et_blog|p=\d+)|\/(noticia|noticias|novedades|prensa|blog|eventos?|agenda)\//;

export type Motivo = 'noticia' | 'basura' | 'sin tema';

/** Por qué se saca una entrada, o null si se queda. */
export function motivoParaSacar(e: { url: string; nombre_oficial: string; temas_sugeridos?: string[] }, sinTema = false): Motivo | null {
  const t = sinTildes(e.nombre_oficial);
  if (BASURA.test(t)) return 'basura';
  if (NOMBRA_TRAMITE.test(t)) return null;
  let ruta = '';
  try {
    ruta = sinTildes(decodeURIComponent(new URL(e.url).pathname + new URL(e.url).search));
  } catch {
    return 'basura';
  }
  if (NOTICIA.test(t) || RUTA_NOTICIA.test(ruta)) return 'noticia';
  if (sinTema && Array.isArray(e.temas_sugeridos) && e.temas_sugeridos.length === 0) return 'sin tema';
  return null;
}

export interface OpcionesLimpiar {
  dirCatalogo?: string;
  /** Sacar también lo que quedó sin tema y no nombra un trámite (después de clasificar). */
  sinTema?: boolean;
  /** Solo cuenta y muestra ejemplos, sin escribir. */
  enSeco?: boolean;
}

export async function pasoLimpiar(o: OpcionesLimpiar = {}): Promise<number> {
  const dir = o.dirCatalogo ?? rutaDatos('catalogo');
  const cuenta: Record<string, number> = {};
  const ejemplos: Record<string, string[]> = {};
  let total = 0;
  let sacadas = 0;
  for (const archivo of await listarJson(dir)) {
    const entradas = await leerJson<{ url: string; nombre_oficial: string; temas_sugeridos?: string[] }[]>(`${dir}/${archivo}`);
    total += entradas.length;
    const quedan = entradas.filter((e) => {
      const m = motivoParaSacar(e, o.sinTema);
      if (!m) return true;
      cuenta[m] = (cuenta[m] ?? 0) + 1;
      const lista = (ejemplos[m] ??= []);
      if (lista.length < 15 && Math.random() < 0.05) lista.push(e.nombre_oficial.slice(0, 70));
      return false;
    });
    sacadas += entradas.length - quedan.length;
    if (!o.enSeco && quedan.length !== entradas.length) await escribirJson(`${dir}/${archivo}`, quedan);
  }
  esperarLinea(`${o.enSeco ? '[en seco] ' : ''}De ${total} entradas se ${o.enSeco ? 'sacarían' : 'sacaron'} ${sacadas}: ${JSON.stringify(cuenta)}`);
  for (const [m, l] of Object.entries(ejemplos)) esperarLinea(`  ${m}: ${l.join(' · ')}`);
  return sacadas;
}
