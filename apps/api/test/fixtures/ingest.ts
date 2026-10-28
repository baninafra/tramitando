/** Datos de prueba compartidos por los tests de reportes e ingesta. */
import type { BorradorFicha, ContenidoFicha } from '@tramitando/shared';
import { env } from 'cloudflare:test';

export const URL_FUENTE = 'https://www.argentina.gob.ar/tramites/renovacion-dni';
export const URL_FUENTE_SECUNDARIA = 'https://www.argentina.gob.ar/tramites/renovacion-dni/requisitos';

export const CONTENIDO_EJEMPLO: ContenidoFicha = {
  quien_puede: ['Personas mayores de 18 años con DNI argentino.'],
  requisitos: [{ texto: 'DNI vigente', aclaracion: null }],
  pasos_online: [{ texto: 'Ingresá al sitio oficial y pedí un turno.' }],
  pasos_presencial: [{ texto: 'Presentate en la oficina con el DNI.' }],
  requiere_turno: true,
  turno_url: 'https://www.argentina.gob.ar/turnos',
  plazo: '15 días hábiles',
  consejos: ['Llevá el DNI original.'],
};

export function borradorEjemplo(overrides: Partial<BorradorFicha> = {}): BorradorFicha {
  return {
    tramite: {
      slug: 'renovacion-dni',
      nombre: 'Renovación de DNI',
      nombre_busqueda: 'Renovar el DNI',
      resumen: 'Renovación del Documento Nacional de Identidad para personas mayores de edad.',
      sinonimos: ['renovar documento', 'dni nuevo'],
      temas: ['documentos'],
      temas_propuestos: [],
    },
    jurisdiccion_id: 'nacion',
    organismo: {
      nombre: 'Registro Nacional de las Personas',
      sigla: 'RENAPER',
      web: 'https://www.argentina.gob.ar/interior/renaper',
    },
    contenido: CONTENIDO_EJEMPLO,
    costos: [
      {
        modalidad: 'Trámite normal',
        gratis: true,
        monto_centavos: null,
        vigente_desde: null,
        nota: null,
        fuente_url: URL_FUENTE,
      },
    ],
    oficinas: [
      {
        nombre: 'RENAPER Central',
        direccion: 'Av. Antártida Argentina 1355',
        localidad: 'Ciudad Autónoma de Buenos Aires',
        horario: 'Lunes a viernes de 8 a 16',
        fuente_url: URL_FUENTE,
      },
    ],
    fuentes: [
      {
        url: URL_FUENTE,
        titulo: 'Renovación de DNI',
        bloques: ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'donde', 'consejos'],
        consultada_en: '2026-01-10T12:00:00.000Z',
      },
    ],
    sin_confirmar: [],
    ...overrides,
  };
}

const TABLAS_EN_ORDEN_DE_BORRADO = [
  'reportes',
  'verificaciones',
  'borradores',
  'variante_fuentes',
  'costos',
  'oficinas',
  'cola_trabajo',
  'catalogo',
  'variantes',
  'tramite_temas',
  'tramites_relacionados',
  'fuentes',
  'organismos',
  'temas',
  'slugs_historicos',
  'jurisdicciones',
  'tramites',
  'tramites_fts',
];

/** Deja la base como recién migrada. */
export async function limpiarBase(): Promise<void> {
  await env.DB.batch(TABLAS_EN_ORDEN_DE_BORRADO.map((tabla) => env.DB.prepare(`DELETE FROM ${tabla}`)));
}

export async function crearJurisdiccion(
  id: string,
  nivel: 'nacion' | 'provincia' | 'municipio',
  nombre: string,
  slug: string,
  padreId: string | null = null,
): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO jurisdicciones (id, nivel, nombre, slug, padre_id) VALUES (?, ?, ?, ?, ?)')
    .bind(id, nivel, nombre, slug, padreId)
    .run();
}

/** Nación y una provincia, lo mínimo para probar jurisdicciones y prioridades. */
export async function sembrarJurisdicciones(): Promise<void> {
  await crearJurisdiccion('nacion', 'nacion', 'Nación', 'nacion');
  await crearJurisdiccion('prov-06', 'provincia', 'Buenos Aires', 'buenos-aires', 'nacion');
}

export async function crearTema(slug: string, nombre: string, padreId: number | null = null): Promise<number> {
  const existente = await env.DB.prepare('SELECT id FROM temas WHERE slug = ?').bind(slug).first<{ id: number }>();
  if (existente) return existente.id;
  const insertado = await env.DB.prepare(
    "INSERT INTO temas (tipo, slug, nombre, descripcion, padre_id, estado) VALUES ('tema', ?, ?, '', ?, 'activo')",
  )
    .bind(slug, nombre, padreId)
    .run();
  return insertado.meta.last_row_id;
}

export interface FichaSembrada {
  varianteId: number;
  tramiteId: number;
  organismoId: number;
  temaId: number;
  fuenteId: number;
}

/**
 * Publica una ficha completa (trámite, tema, organismo, variante, costo, oficina y fuentes)
 * a partir de `borradorEjemplo`, para que el diff de una actualización tenga una base real.
 */
export async function sembrarFichaPublicada(
  opciones: { contenido?: ContenidoFicha; proximaRevision?: string; verificacion?: 'verificado' | 'revisar' } = {},
): Promise<FichaSembrada> {
  await sembrarJurisdicciones();
  const borrador = borradorEjemplo(opciones.contenido ? { contenido: opciones.contenido } : {});
  const temaId = await crearTema(borrador.tramite.temas[0] ?? 'documentos', 'Documentos');

  const organismo = await env.DB.prepare(
    `INSERT INTO organismos (slug, nombre, sigla, descripcion, jurisdiccion_id, web)
     VALUES ('renaper', ?, ?, '', 'nacion', ?)`,
  )
    .bind(borrador.organismo.nombre, borrador.organismo.sigla, borrador.organismo.web)
    .run();
  const organismoId = organismo.meta.last_row_id;

  const tramite = await env.DB.prepare(
    `INSERT INTO tramites (slug, nombre, nombre_busqueda, resumen, sinonimos, popularidad)
     VALUES (?, ?, ?, ?, ?, 1)`,
  )
    .bind(
      borrador.tramite.slug,
      borrador.tramite.nombre,
      borrador.tramite.nombre_busqueda,
      borrador.tramite.resumen,
      JSON.stringify(borrador.tramite.sinonimos),
    )
    .run();
  const tramiteId = tramite.meta.last_row_id;

  await env.DB.prepare('INSERT INTO tramite_temas (tramite_id, tema_id, principal) VALUES (?, ?, 1)')
    .bind(tramiteId, temaId)
    .run();

  const fuenteIds = new Map<string, number>();
  for (const fuente of borrador.fuentes) {
    const insertada = await env.DB.prepare('INSERT OR IGNORE INTO fuentes (url, titulo) VALUES (?, ?)')
      .bind(fuente.url, fuente.titulo)
      .run();
    let fuenteId = insertada.meta.last_row_id;
    if (insertada.meta.changes === 0) {
      const fila = await env.DB.prepare('SELECT id FROM fuentes WHERE url = ?').bind(fuente.url).first<{ id: number }>();
      fuenteId = fila?.id ?? 0;
    }
    fuenteIds.set(fuente.url, fuenteId);
  }

  const ahora = new Date().toISOString();
  const proxima = opciones.proximaRevision ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const variante = await env.DB.prepare(
    `INSERT INTO variantes
       (tramite_id, jurisdiccion_id, organismo_id, estado, verificacion, contenido, verificado_en, proxima_revision)
     VALUES (?, 'nacion', ?, 'publicada', ?, ?, ?, ?)`,
  )
    .bind(
      tramiteId,
      organismoId,
      opciones.verificacion ?? 'verificado',
      JSON.stringify(opciones.contenido ?? borrador.contenido),
      ahora,
      proxima,
    )
    .run();
  const varianteId = variante.meta.last_row_id;

  for (const [indice, costo] of borrador.costos.entries()) {
    await env.DB.prepare(
      `INSERT INTO costos (variante_id, modalidad, monto_centavos, gratis, vigente_desde, nota, fuente_id, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        varianteId,
        costo.modalidad,
        costo.monto_centavos,
        costo.gratis ? 1 : 0,
        costo.vigente_desde,
        costo.nota,
        fuenteIds.get(costo.fuente_url) ?? null,
        indice,
      )
      .run();
  }

  for (const fuente of borrador.fuentes) {
    const fuenteId = fuenteIds.get(fuente.url);
    if (!fuenteId) continue;
    for (const bloque of fuente.bloques) {
      await env.DB.prepare('INSERT OR IGNORE INTO variante_fuentes (variante_id, fuente_id, bloque) VALUES (?, ?, ?)')
        .bind(varianteId, fuenteId, bloque)
        .run();
    }
  }

  for (const oficina of borrador.oficinas) {
    await env.DB.prepare(
      `INSERT INTO oficinas (organismo_id, jurisdiccion_id, nombre, direccion, localidad, horario, fuente_id)
       VALUES (?, 'nacion', ?, ?, ?, ?, ?)`,
    )
      .bind(
        organismoId,
        oficina.nombre,
        oficina.direccion,
        oficina.localidad,
        oficina.horario,
        fuenteIds.get(oficina.fuente_url) ?? null,
      )
      .run();
  }

  return { varianteId, tramiteId, organismoId, temaId, fuenteId: fuenteIds.get(URL_FUENTE) ?? 0 };
}

export async function crearItemCola(opciones: {
  catalogoId?: number | null;
  varianteId?: number | null;
  motivo?: 'nueva' | 'cambio_fuente' | 'vencida' | 'reporte' | 'costos';
  prioridad?: number;
}): Promise<number> {
  const insertado = await env.DB.prepare('INSERT INTO cola_trabajo (catalogo_id, variante_id, motivo, prioridad) VALUES (?, ?, ?, ?)')
    .bind(
      opciones.catalogoId ?? null,
      opciones.varianteId ?? null,
      opciones.motivo ?? 'nueva',
      opciones.prioridad ?? 100,
    )
    .run();
  return insertado.meta.last_row_id;
}
