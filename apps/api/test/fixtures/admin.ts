/**
 * Datos de prueba para los tests del dashboard.
 *
 * Cada test parte de una base vacía (vitest-pool-workers aísla el storage), así que estas helpers
 * siembran solo lo que el caso necesita.
 */
import type { BorradorFicha, BorradorTema } from '@tramitando/shared';

export const URL_FUENTE = 'https://www.argentina.gob.ar/interior/renaper';
export const URL_FUENTE_2 = 'https://www.argentina.gob.ar/servicio/renovar-dni';

/** Deja la base como recién migrada (los tests de este archivo comparten storage). */
export async function limpiarBase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM borradores'),
    db.prepare('DELETE FROM cola_trabajo'),
    db.prepare('DELETE FROM reportes'),
    db.prepare('DELETE FROM catalogo'),
    db.prepare('DELETE FROM variante_fuentes'),
    db.prepare('DELETE FROM costos'),
    db.prepare('DELETE FROM verificaciones'),
    db.prepare('DELETE FROM oficinas'),
    db.prepare('DELETE FROM fuentes'),
    db.prepare('DELETE FROM variantes'),
    db.prepare('DELETE FROM tramite_temas'),
    db.prepare('DELETE FROM tramites_relacionados'),
    db.prepare('DELETE FROM tramites_fts'),
    db.prepare('DELETE FROM tramites'),
    db.prepare('DELETE FROM slugs_historicos'),
    db.prepare('DELETE FROM temas'),
    db.prepare('DELETE FROM organismos'),
    db.prepare('DELETE FROM jurisdicciones'),
  ]);
}

export async function sembrarBase(db: D1Database): Promise<void> {
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO jurisdicciones (id, nivel, nombre, slug) VALUES ('nacion', 'nacion', 'Nación', 'nacion')")
      .bind(),
    db
      .prepare(
        "INSERT OR IGNORE INTO jurisdicciones (id, nivel, nombre, slug, padre_id) VALUES ('prov-06', 'provincia', 'Buenos Aires', 'buenos-aires', 'nacion')",
      )
      .bind(),
    db
      .prepare(
        "INSERT OR IGNORE INTO temas (slug, nombre, descripcion, tipo, estado) VALUES ('documentos', 'Documentos', '', 'tema', 'activo')",
      )
      .bind(),
    db
      .prepare(
        "INSERT OR IGNORE INTO temas (slug, nombre, descripcion, tipo, estado) VALUES ('identidad', 'Identidad', '', 'tema', 'activo')",
      )
      .bind(),
    db
      .prepare(
        "INSERT OR IGNORE INTO temas (slug, nombre, descripcion, tipo, estado) VALUES ('tema-propuesto', 'Tema propuesto', '', 'tema', 'propuesto')",
      )
      .bind(),
  ]);
}

export interface OpcionesFicha {
  slug?: string;
  nombre?: string;
  temas?: string[];
  jurisdiccion?: string;
  costos?: BorradorFicha['costos'];
  oficinas?: BorradorFicha['oficinas'];
  fuentes?: BorradorFicha['fuentes'];
  temasPropuestos?: BorradorFicha['tramite']['temas_propuestos'];
}

export function fichaEjemplo(opciones: OpcionesFicha = {}): BorradorFicha {
  const slug = opciones.slug ?? 'renovar-dni';
  return {
    tramite: {
      slug,
      nombre: opciones.nombre ?? 'Renovación de DNI',
      nombre_busqueda: 'Renovar el DNI',
      resumen: 'Renovás tu DNI y lo retirás en el RENAPER o en un registro civil.',
      sinonimos: ['renovar documento', 'dni vencido'],
      temas: opciones.temas ?? ['documentos', 'identidad'],
      temas_propuestos: opciones.temasPropuestos ?? [],
    },
    jurisdiccion_id: opciones.jurisdiccion ?? 'nacion',
    organismo: { nombre: 'RENAPER', sigla: 'RENAPER', web: 'https://www.argentina.gob.ar/interior/renaper' },
    contenido: {
      quien_puede: ['Personas mayores de edad con DNI vencido'],
      requisitos: [{ texto: 'Llevá tu DNI anterior', aclaracion: null }],
      pasos_online: [{ texto: 'Sacá turno online' }],
      pasos_presencial: [{ texto: 'Andá a la oficina con el DNI viejo' }],
      requiere_turno: true,
      turno_url: 'https://www.argentina.gob.ar/interior/renaper',
      plazo: '15 días hábiles',
      consejos: ['Pedí el turno con anticipación'],
    },
    costos: opciones.costos ?? [
      {
        modalidad: 'Trámite normal',
        gratis: false,
        monto_centavos: 1_250_000,
        vigente_desde: '2026-01-01',
        nota: null,
        fuente_url: URL_FUENTE,
      },
    ],
    oficinas: opciones.oficinas ?? [
      {
        nombre: 'RENAPER Central',
        direccion: 'Av. Jujuy 468',
        localidad: 'Ciudad Autónoma de Buenos Aires',
        horario: 'Lunes a viernes de 8 a 16',
        fuente_url: URL_FUENTE,
      },
    ],
    fuentes: opciones.fuentes ?? [
      {
        url: URL_FUENTE,
        titulo: 'RENAPER',
        bloques: ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'donde', 'consejos'],
        consultada_en: '2026-10-01T12:00:00.000Z',
      },
    ],
    sin_confirmar: [],
  };
}

export function temaEjemplo(overrides: Partial<BorradorTema> = {}): BorradorTema {
  return {
    slug: 'tema-nuevo',
    nombre: 'Tema nuevo',
    descripcion: '',
    tipo: 'tema',
    padre: null,
    ...overrides,
  };
}

export interface OpcionesBorrador {
  tipo?: 'ficha_nueva' | 'actualizacion' | 'tema_nuevo';
  origen?: 'ia' | 'reporte' | 'admin';
  catalogo_id?: number | null;
  variante_id?: number | null;
  reporte_id?: number | null;
  chequeos?: string[];
}

export async function insertarBorrador(
  db: D1Database,
  payload: BorradorFicha | BorradorTema,
  opciones: OpcionesBorrador = {},
): Promise<number> {
  const fila = await db
    .prepare(
      `INSERT INTO borradores (tipo, origen, catalogo_id, variante_id, reporte_id, payload, chequeos, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente')
       RETURNING id`,
    )
    .bind(
      opciones.tipo ?? 'ficha_nueva',
      opciones.origen ?? 'ia',
      opciones.catalogo_id ?? null,
      opciones.variante_id ?? null,
      opciones.reporte_id ?? null,
      JSON.stringify(payload),
      JSON.stringify(opciones.chequeos ?? []),
    )
    .first<{ id: number }>();
  return fila!.id;
}

export async function crearCatalogo(
  db: D1Database,
  url = URL_FUENTE,
  nombre = 'Renovación de DNI',
): Promise<number> {
  const fila = await db
    .prepare(
      `INSERT INTO catalogo (url, nombre_oficial, jurisdiccion_id, organismo, portal, prioridad)
       VALUES (?, ?, 'nacion', 'RENAPER', 'argentina.gob.ar', 100)
       RETURNING id`,
    )
    .bind(url, nombre)
    .first<{ id: number }>();
  return fila!.id;
}

export interface OpcionesVariante {
  slug?: string;
  nombre?: string;
  jurisdiccion?: string;
  popularidad?: number | null;
}

export async function sembrarTramiteYVariante(
  db: D1Database,
  opciones: OpcionesVariante = {},
): Promise<{ tramiteId: number; varianteId: number }> {
  const slug = opciones.slug ?? 'renovar-dni';
  const nombre = opciones.nombre ?? 'Renovación de DNI';
  const jurisdiccion = opciones.jurisdiccion ?? 'nacion';

  const tramite = await db
    .prepare(
      `INSERT INTO tramites (slug, nombre, nombre_busqueda, resumen, sinonimos, popularidad)
       VALUES (?, ?, 'Renovar el DNI', 'Resumen de prueba del trámite.', '["dni"]', ?)
       RETURNING id`,
    )
    .bind(slug, nombre, opciones.popularidad ?? 10)
    .first<{ id: number }>();

  const contenido = {
    quien_puede: ['Personas mayores de edad'],
    requisitos: [{ texto: 'DNI anterior', aclaracion: null }],
    pasos_online: [],
    pasos_presencial: [{ texto: 'Ir a la oficina' }],
    requiere_turno: false,
    turno_url: null,
    plazo: null,
    consejos: [],
  };

  const variante = await db
    .prepare(
      `INSERT INTO variantes (tramite_id, jurisdiccion_id, estado, verificacion, contenido, verificado_en, proxima_revision)
       VALUES (?, ?, 'publicada', 'verificado', ?, '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
       RETURNING id`,
    )
    .bind(tramite!.id, jurisdiccion, JSON.stringify(contenido))
    .first<{ id: number }>();

  return { tramiteId: tramite!.id, varianteId: variante!.id };
}

export async function insertarReporte(
  db: D1Database,
  varianteId: number,
  opciones: { email?: string | null; r2Key?: string | null } = {},
): Promise<number> {
  const fila = await db
    .prepare(
      `INSERT INTO reportes (variante_id, bloque, descripcion, prueba_url, prueba_r2_key, email, ip_hash)
       VALUES (?, 'costo', 'El costo está desactualizado', ?, ?, ?, 'hash-de-prueba')
       RETURNING id`,
    )
    .bind(
      varianteId,
      opciones.r2Key ? null : 'https://www.argentina.gob.ar/interior/renaper',
      opciones.r2Key ?? null,
      opciones.email === undefined ? 'persona@ejemplo.com' : opciones.email,
    )
    .first<{ id: number }>();
  return fila!.id;
}
