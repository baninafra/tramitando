import {
  BLOQUES,
  BorradorFicha,
  chequearBorrador,
  esUrlOficial,
  type Bloque,
  type BorradorFicha as BorradorFichaTipo,
} from '@tramitando/shared';
import { z } from 'zod';
import type { DescargarFn } from './crawler.js';
import { extraerTexto } from './texto.js';

export type Preguntar = <T>(prompt: string, esquema: z.ZodType<T>) => Promise<T>;

/** La página no es un trámite (una noticia o una sección del sitio): no se arma ficha y se descarta. */
export class NoEsTramite extends Error {
  constructor(readonly tipo: 'noticia' | 'otro') {
    super(tipo === 'noticia' ? 'es una noticia, no un trámite' : 'no es un trámite');
  }
}

const TipoPagina = z.object({ tipo: z.enum(['tramite', 'noticia', 'otro']) });

/**
 * Los catálogos municipales mezclan noticias y secciones con los trámites. Antes de armar la ficha se
 * pregunta, con un prompt corto, qué es la página. Ante la duda (o si el modelo no contesta en forma) se
 * sigue como trámite: los chequeos de la ficha frenan lo que salga vacío.
 */
export async function tipoDePagina(
  nombre: string,
  titulo: string,
  texto: string,
  preguntar: Preguntar,
): Promise<'tramite' | 'noticia' | 'otro'> {
  const prompt = [
    'Clasificá esta página de un sitio oficial argentino. Respondé SOLO un JSON: {"tipo": "tramite"}, {"tipo": "noticia"} o {"tipo": "otro"}.',
    '- "tramite": explica un trámite o servicio que una persona puede pedir o hacer (requisitos, pasos, dónde ir, formularios, turnos, pagos, inscripciones, licencias, habilitaciones).',
    '- "noticia": nota de prensa, novedad, crónica de un evento, anuncio o comunicado (por ejemplo "El intendente inauguró…", "Comenzó la campaña…", "45 jóvenes se capacitaron…").',
    '- "otro": portada o sección del sitio sin un trámite concreto (por ejemplo "Deportes", "Turismo", "Historia de la ciudad").',
    'Si la página tiene requisitos o pasos para hacer algo, es "tramite" aunque también anuncie algo.',
    '',
    `Nombre en el catálogo: ${nombre}`,
    `Título de la página: ${titulo}`,
    `Texto (comienzo): ${texto.slice(0, 1500)}`,
  ].join('\n');
  try {
    const r = await preguntar(prompt, TipoPagina);
    return r?.tipo === 'noticia' || r?.tipo === 'otro' ? r.tipo : 'tramite';
  } catch {
    return 'tramite';
  }
}

export interface EntradaFicha {
  url: string;
  nombre_oficial: string;
  jurisdiccion_id: string;
  portal?: string;
  tramite_slug?: string | null;
  /** Al rehacer una ficha publicada: su slug, para que la actualice en vez de crear otra. */
  slug_fijo?: string | null;
}

export interface DependenciasFicha {
  descargar: DescargarFn;
  preguntar: Preguntar;
  temas: string[];
  /** Slugs de los temas de primer nivel: no sirven como slug de un trámite. */
  temasPadre?: string[];
  promptFicha: string;
  ahora?: () => Date;
  maxEnlazadas?: number;
}

export interface ResultadoFicha {
  borrador: BorradorFichaTipo;
  chequeos: string[];
  paginas_descargadas: string[];
}

// Con la ficha y 2 enlazadas alcanza: más páginas alargan el prompt y el modelo local tarda el doble.
const MAX_ENLAZADAS = 2;
const MAX_TEXTO_PAGINA = 12_000;

/** Lo que el modelo suele escribir en vez de los nombres de bloque válidos. */
const SINONIMOS_BLOQUE: Record<string, Bloque> = {
  requisito: 'requisitos', documentacion: 'requisitos', documentos: 'requisitos',
  paso: 'pasos', pasos_online: 'pasos', pasos_presencial: 'pasos', procedimiento: 'pasos', como: 'pasos',
  quien_puede: 'quien', quienes: 'quien', destinatarios: 'quien',
  costos: 'costo', arancel: 'costo', precio: 'costo',
  plazos: 'plazo', tiempo: 'plazo', demora: 'plazo',
  donde_se_hace: 'donde', lugar: 'donde', oficinas: 'donde', contacto: 'donde',
  consejo: 'consejos', recomendaciones: 'consejos', descripcion: 'resumen', que_es: 'resumen',
};

/**
 * Corrige en el código los errores de forma que el modelo local comete seguido (nombres de bloque, sinónimos
 * largos) en vez de rechazar la respuesta y volver a preguntar todo: eso duplicaba el tiempo de cada ficha.
 */
export function normalizarRespuestaFicha(crudo: unknown): unknown {
  if (!crudo || typeof crudo !== 'object') return crudo;
  type Obj = Record<string, unknown>;
  const r = crudo as Obj & { fuentes?: Obj[]; tramite?: Obj; contenido?: Obj; costos?: unknown; oficinas?: unknown };
  const corto = (v: unknown, max: number) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v);
  const esObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const fuentePrincipal = Array.isArray(r.fuentes) && esObj(r.fuentes[0]) ? r.fuentes[0].url : undefined;

  // La jurisdicción la pone el código después; acá solo evita que la validación rechace todo por eso.
  if (r.jurisdiccion_id === undefined) r.jurisdiccion_id = 'pendiente';
  if (esObj(r.tramite)) {
    r.tramite.nombre = corto(r.tramite.nombre, 120);
    r.tramite.nombre_busqueda = corto(r.tramite.nombre_busqueda ?? r.tramite.nombre, 120);
    r.tramite.resumen = corto(r.tramite.resumen, 400);
  }
  const c = r.contenido;
  if (esObj(c)) {
    for (const k of ['pasos_online', 'pasos_presencial'] as const) {
      c[k] = (Array.isArray(c[k]) ? c[k] : []).map((p) => (typeof p === 'string' ? { texto: p } : p)).filter(esObj)
        .map((p) => ({ ...p, texto: corto(p.texto, 500) })).filter((p) => typeof p.texto === 'string' && p.texto.length > 0);
    }
    c.requisitos = (Array.isArray(c.requisitos) ? c.requisitos : []).map((q) => (typeof q === 'string' ? { texto: q } : q)).filter(esObj)
      .map((q) => ({ texto: corto(q.texto, 300), aclaracion: corto(q.aclaracion ?? null, 300) }));
    c.quien_puede = (Array.isArray(c.quien_puede) ? c.quien_puede : []).filter((x): x is string => typeof x === 'string' && x.length > 0).map((x) => corto(x, 300));
    c.consejos = (Array.isArray(c.consejos) ? c.consejos : []).filter((x): x is string => typeof x === 'string').map((x) => corto(x, 300));
    c.plazo = corto(c.plazo ?? null, 200);
    if (c.requiere_turno === undefined) c.requiere_turno = null;
    if (c.turno_url === undefined) c.turno_url = null;
  }
  // Oficinas y costos sin fuente: salieron de las páginas que se le pasaron, se les pone la principal.
  r.oficinas = (Array.isArray(r.oficinas) ? r.oficinas : []).filter(esObj)
    .filter((o) => typeof o.nombre === 'string' && o.nombre && typeof o.direccion === 'string' && o.direccion)
    .map((o) => ({ ...o, localidad: o.localidad || o.direccion, horario: o.horario ?? null, fuente_url: o.fuente_url ?? fuentePrincipal }))
    .slice(0, 50);
  r.costos = (Array.isArray(r.costos) ? r.costos : []).filter(esObj).map((k) => {
    const monto = typeof k.monto_centavos === 'number' ? k.monto_centavos : null;
    const gratis = typeof k.gratis === 'boolean' ? k.gratis : monto === null ? null : false;
    return { ...k, modalidad: corto(k.modalidad || 'General', 120), gratis, monto_centavos: gratis ? null : monto,
      vigente_desde: k.vigente_desde ?? null, nota: corto(k.nota ?? null, 300), fuente_url: k.fuente_url ?? fuentePrincipal };
  }).filter((k) => k.gratis === true || (k.gratis === false && k.monto_centavos !== null));
  for (const f of Array.isArray(r.fuentes) ? r.fuentes : []) {
    if (!esObj(f)) continue;
    f.titulo = corto(f.titulo || f.url, 300);
    if (!f.consultada_en) f.consultada_en = new Date().toISOString();
  }

  for (const f of Array.isArray(r.fuentes) ? r.fuentes : []) {
    if (!f || !Array.isArray(f.bloques)) continue;
    const limpios = f.bloques
      .map((b) => (typeof b === 'string' ? b.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_') : ''))
      .map((b) => ((BLOQUES as readonly string[]).includes(b) ? (b as Bloque) : SINONIMOS_BLOQUE[b]))
      .filter((b): b is Bloque => Boolean(b));
    f.bloques = limpios.length ? [...new Set(limpios)] : ['resumen'];
  }
  if (r.tramite && Array.isArray(r.tramite.sinonimos)) {
    r.tramite.sinonimos = r.tramite.sinonimos.filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 80).slice(0, 20);
  }

  // Relleno del modelo ("No se especifican requisitos en el texto"): no es un requisito ni un paso.
  const relleno = /^\s*(no se (especifica|indica|menciona|detalla)n?|no (hay|existen|figuran|aparecen) (requisitos|pasos|datos)|sin (requisitos|datos)|no (est[aá]|aparece) (en el texto|especificad))/i;
  if (esObj(c)) {
    c.requisitos = (c.requisitos as Obj[]).filter((q) => !relleno.test(String(q.texto ?? '')));
    for (const k of ['pasos_online', 'pasos_presencial'] as const) c[k] = (c[k] as Obj[]).filter((p) => !relleno.test(String(p.texto ?? '')));
    c.quien_puede = (c.quien_puede as string[]).filter((x) => !relleno.test(x));
    // Repetidos exactos.
    c.requisitos = (c.requisitos as Obj[]).filter((q, i, todos) => todos.findIndex((o) => o.texto === q.texto) === i);
  }

  // El modelo repite el mismo costo varias veces.
  if (Array.isArray(r.costos)) {
    const vistos = new Set<string>();
    r.costos = r.costos.filter((k) => {
      const clave = esObj(k) ? `${String(k.modalidad)}|${String(k.monto_centavos)}|${String(k.gratis)}` : '';
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  }

  // Bloques con contenido que ninguna fuente respalda: salieron de las páginas dadas, van a la principal.
  if (Array.isArray(r.fuentes) && esObj(r.fuentes[0]) && Array.isArray(r.fuentes[0].bloques) && esObj(c)) {
    const cubiertos = new Set(r.fuentes.flatMap((f) => (esObj(f) && Array.isArray(f.bloques) ? f.bloques : [])));
    const conContenido: [Bloque, boolean][] = [
      ['quien', (c.quien_puede as unknown[]).length > 0],
      ['requisitos', (c.requisitos as unknown[]).length > 0],
      ['pasos', (c.pasos_online as unknown[]).length + (c.pasos_presencial as unknown[]).length > 0],
      ['costo', (r.costos as unknown[]).length > 0],
    ];
    for (const [bloque, hay] of conContenido) if (hay && !cubiertos.has(bloque)) r.fuentes[0].bloques.push(bloque);
  }

  // Frases copiadas EN MAYÚSCULAS de la página oficial: se bajan a minúscula (las siglas sueltas quedan).
  const sinGritos = (v: unknown) => {
    if (typeof v !== 'string') return v;
    const t = v.replace(/(?<!\p{L})(?:\p{Lu}{2,}[\s,;:–\-()/.]+){2,}\p{Lu}{2,}(?!\p{L})/gu, (m) => m.toLowerCase());
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  if (esObj(r.tramite)) r.tramite.resumen = sinGritos(r.tramite.resumen);
  if (esObj(c)) {
    for (const q of c.requisitos as Obj[]) Object.assign(q, { texto: sinGritos(q.texto), aclaracion: sinGritos(q.aclaracion) });
    for (const k of ['pasos_online', 'pasos_presencial'] as const) for (const p of c[k] as Obj[]) p.texto = sinGritos(p.texto);
    c.quien_puede = (c.quien_puede as unknown[]).map(sinGritos);
    c.consejos = (c.consejos as unknown[]).map(sinGritos);
  }
  return crudo;
}

const BorradorTolerante = z.preprocess(normalizarRespuestaFicha, BorradorFicha);

const PALABRAS_RELEVANTES = [
  'requisito',
  'document',
  'arancel',
  'costo',
  'pago',
  'turno',
  'cita',
  'oficina',
  'donde',
  'dónde',
  'present',
  'formulario',
  'plazo',
];

function normalizar(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

function puntaje(link: { url: string; texto: string }): number {
  const texto = `${link.url} ${link.texto}`.toLowerCase();
  return PALABRAS_RELEVANTES.reduce((total, palabra) => total + (texto.includes(palabra) ? 1 : 0), 0);
}

function elegirEnlazadas(
  links: { url: string; texto: string }[],
  fichaUrl: string,
  maximo: number,
): { url: string; texto: string }[] {
  const vistos = new Set<string>([normalizar(fichaUrl)]);
  const candidatos: { url: string; texto: string; puntos: number }[] = [];
  for (const link of links) {
    if (!esUrlOficial(link.url)) continue;
    const limpia = normalizar(link.url);
    if (vistos.has(limpia)) continue;
    vistos.add(limpia);
    candidatos.push({ url: limpia, texto: link.texto, puntos: puntaje(link) });
  }
  return candidatos
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, maximo)
    .map(({ url, texto }) => ({ url, texto }));
}

/** true si todas las URLs citadas por el borrador son páginas que efectivamente bajamos. */
export function fuentesNoDescargadas(borrador: BorradorFichaTipo, descargadas: Set<string>): string[] {
  const citadas = new Set<string>();
  for (const fuente of borrador.fuentes) citadas.add(normalizar(fuente.url));
  for (const costo of borrador.costos) citadas.add(normalizar(costo.fuente_url));
  for (const oficina of borrador.oficinas) citadas.add(normalizar(oficina.fuente_url));
  if (borrador.contenido.turno_url) citadas.add(normalizar(borrador.contenido.turno_url));
  return [...citadas].filter((url) => !descargadas.has(url));
}

export function validarFuentesDescargadas(borrador: BorradorFichaTipo, descargadas: Set<string>): void {
  const faltantes = fuentesNoDescargadas(borrador, descargadas);
  if (faltantes.length > 0) {
    throw new Error(
      `El borrador cita fuentes que no se descargaron: ${faltantes.join(', ')}`,
    );
  }
}

function armarPrompt(
  plantilla: string,
  entrada: EntradaFicha,
  temas: string[],
  paginas: { url: string; titulo: string; texto: string }[],
  fecha: string,
): string {
  const partes = [
    plantilla.trim(),
    '',
    '# Datos de esta investigación',
    `- Jurisdicción (id): ${entrada.jurisdiccion_id}`,
    `- Nombre oficial de la ficha: ${entrada.nombre_oficial}`,
    `- URL de la ficha: ${entrada.url}`,
    `- Fecha de consulta (usala en consultada_en): ${fecha}`,
    '',
    '## Temas disponibles (usá SOLO estos slugs)',
    temas.join(', '),
    '',
    '## Páginas descargadas (usá SOLO estas URLs como fuentes)',
  ];
  for (const [indice, pagina] of paginas.entries()) {
    partes.push(
      '',
      `### Página ${indice + 1}: ${pagina.url}`,
      `Título: ${pagina.titulo || '(sin título)'}`,
      '',
      pagina.texto.slice(0, MAX_TEXTO_PAGINA),
    );
  }
  partes.push(
    '',
    'Respondé SOLO con un JSON válido que cumpla el esquema BorradorFicha. Sin texto alrededor.',
  );
  return partes.join('\n');
}

/**
 * Descarga la ficha y hasta 5 páginas oficiales enlazadas relevantes, y le pide a Gemini un
 * BorradorFicha. Rechaza borradores que citen URLs que no formaron parte de la descarga.
 */
export async function investigarFicha(
  entrada: EntradaFicha,
  deps: DependenciasFicha,
): Promise<ResultadoFicha> {
  const maxEnlazadas = deps.maxEnlazadas ?? MAX_ENLAZADAS;
  const ahora = deps.ahora ?? (() => new Date());

  const ficha = await deps.descargar(entrada.url);
  if (ficha.tipo === 'pdf' || ficha.tipo === 'otro') {
    throw new Error(`La ficha ${entrada.url} es ${ficha.tipo}; todavía no procesamos ese formato`);
  }

  const descargadas = new Set<string>([normalizar(ficha.url_final), normalizar(entrada.url)]);
  const paginas: { url: string; titulo: string; texto: string }[] = [];
  if (ficha.tipo === 'html') {
    const extraida = extraerTexto(ficha.cuerpo, ficha.url_final);
    const tipo = await tipoDePagina(entrada.nombre_oficial, extraida.titulo, extraida.texto, deps.preguntar);
    if (tipo !== 'tramite') throw new NoEsTramite(tipo);
    paginas.push({ url: ficha.url_final, titulo: extraida.titulo, texto: extraida.texto });
    const enlazadas = elegirEnlazadas(extraida.links, ficha.url_final, maxEnlazadas);
    const bajadas = await Promise.allSettled(
      enlazadas.map(async (link) => ({ link, descarga: await deps.descargar(link.url) })),
    );
    for (const resultado of bajadas) {
      if (resultado.status !== 'fulfilled') continue;
      const { link, descarga } = resultado.value;
      if (descarga.tipo === 'pdf' || descarga.tipo === 'otro') continue;
      descargadas.add(normalizar(descarga.url_final));
      if (descarga.tipo === 'html') {
        const pagina = extraerTexto(descarga.cuerpo, descarga.url_final);
        paginas.push({ url: descarga.url_final, titulo: pagina.titulo, texto: pagina.texto });
      } else {
        paginas.push({ url: descarga.url_final, titulo: link.texto, texto: descarga.cuerpo.slice(0, MAX_TEXTO_PAGINA) });
      }
    }
  } else {
    paginas.push({ url: ficha.url_final, titulo: entrada.nombre_oficial, texto: ficha.cuerpo });
  }

  const prompt = armarPrompt(
    deps.promptFicha,
    entrada,
    deps.temas,
    paginas,
    ahora().toISOString(),
  );

  let crudo: z.infer<typeof BorradorTolerante>;
  try {
    crudo = await deps.preguntar(prompt, BorradorTolerante);
  } catch (error) {
    // Sin ningún requisito (sacado el relleno) la página es un servicio o una sección, no un trámite publicable.
    const m = error instanceof Error ? error.message : '';
    if (/"requisitos"/.test(m) && /too_small/.test(m)) throw new NoEsTramite('otro');
    throw error;
  }
  const borrador = BorradorFicha.parse({ ...crudo, jurisdiccion_id: entrada.jurisdiccion_id });

  const temasValidos = borrador.tramite.temas.filter((slug) => deps.temas.includes(slug));
  if (temasValidos.length === 0) {
    throw new Error(
      `El borrador no usa ningún tema de data/temas.json (proponía: ${borrador.tramite.temas.join(', ')})`,
    );
  }
  borrador.tramite.temas = temasValidos;
  // El modelo a veces usa un tema general como slug del trámite ("emprendedores-y-monotributo"): mezclaría
  // trámites distintos en uno. Un subtema sí sirve de trámite común ("licencia-de-conducir": una variante por
  // municipio); un tema padre no, y el slug se arma con el nombre.
  if ((deps.temasPadre ?? []).includes(borrador.tramite.slug)) {
    borrador.tramite.slug = borrador.tramite.nombre
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || borrador.tramite.slug;
  }
  if (entrada.slug_fijo) borrador.tramite.slug = entrada.slug_fijo;

  validarFuentesDescargadas(borrador, descargadas);

  return {
    borrador,
    chequeos: chequearBorrador(borrador),
    paginas_descargadas: [...descargadas],
  };
}
