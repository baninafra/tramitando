/**
 * @tramitando/shared — contrato de datos entre la API, la web y la investigación.
 *
 * Todo JSON que entra a la base (fichas, borradores, catálogo) se valida con estos esquemas.
 * Si cambiás un esquema, revisá la migración SQL y los tests de las tres apps.
 */
import { z } from 'zod';
import { DOMINIOS_MUNICIPALES } from './dominios-municipales.js';

// ---------------------------------------------------------------------------------------------
// Fuentes oficiales
// ---------------------------------------------------------------------------------------------

/** Sufijos de dominio aceptados como fuente oficial. */
export const SUFIJOS_OFICIALES = ['.gob.ar', '.gov.ar'] as const;

/**
 * Dominios oficiales que no terminan en .gob.ar / .gov.ar. Agregar solo organismos públicos,
 * con su motivo al lado.
 */
export const DOMINIOS_OFICIALES_EXTRA: Record<string, string> = {
  'boletinoficial.gob.ar': 'Boletín Oficial de la República Argentina',
  'infoleg.gob.ar': 'Información legislativa',
  'saij.gob.ar': 'Sistema Argentino de Información Jurídica',
  // Sitios propios de municipios con otro dominio, verificados contra fuentes oficiales (ver dominios-municipales.ts).
  ...DOMINIOS_MUNICIPALES,
};

/** true si la URL es https (o http) y su host es un dominio oficial del Estado argentino. */
export function esUrlOficial(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (SUFIJOS_OFICIALES.some((s) => host.endsWith(s) || host === s.slice(1))) return true;
  return Object.keys(DOMINIOS_OFICIALES_EXTRA).some((d) => host === d || host.endsWith(`.${d}`));
}

const urlOficial = z.string().url().refine(esUrlOficial, { message: 'La fuente tiene que ser un dominio oficial (.gob.ar / .gov.ar)' });

// ---------------------------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------------------------

export const BLOQUES = ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'donde', 'consejos'] as const;
export const Bloque = z.enum(BLOQUES);
export type Bloque = z.infer<typeof Bloque>;

export const Fuente = z.object({
  url: urlOficial,
  titulo: z.string().min(1).max(300),
  /** Bloques de la ficha que respalda esta fuente. */
  bloques: z.array(Bloque).min(1),
  /** Fecha en que se leyó (ISO). */
  consultada_en: z.string().datetime(),
});
export type Fuente = z.infer<typeof Fuente>;

export const Costo = z
  .object({
    modalidad: z.string().min(1).max(120),
    gratis: z.boolean(),
    /** Centavos de peso. null si es gratis. */
    monto_centavos: z.number().int().nonnegative().nullable(),
    vigente_desde: z.string().date().nullable(),
    nota: z.string().max(300).nullable(),
    fuente_url: urlOficial,
  })
  .refine((c) => c.gratis || c.monto_centavos !== null, { message: 'Un costo que no es gratis necesita monto' });
export type Costo = z.infer<typeof Costo>;

export const Requisito = z.object({
  texto: z.string().min(1).max(300),
  aclaracion: z.string().max(300).nullable(),
});

export const Paso = z.object({ texto: z.string().min(1).max(500) });

/** Contenido de una variante (columna variantes.contenido). */
export const ContenidoFicha = z.object({
  quien_puede: z.array(z.string().min(1).max(300)).min(1),
  requisitos: z.array(Requisito).min(1),
  pasos_online: z.array(Paso),
  pasos_presencial: z.array(Paso),
  requiere_turno: z.boolean().nullable(),
  turno_url: urlOficial.nullable(),
  plazo: z.string().max(200).nullable(),
  consejos: z.array(z.string().max(300)),
});
export type ContenidoFicha = z.infer<typeof ContenidoFicha>;

export const OficinaEntrada = z.object({
  nombre: z.string().min(1),
  direccion: z.string().min(1),
  localidad: z.string().min(1),
  horario: z.string().nullable(),
  fuente_url: urlOficial,
});

/**
 * Lo que produce la investigación para una ficha y lo que viaja en un borrador.
 * Identifica el trámite por slug y la jurisdicción por id de la tabla jurisdicciones.
 */
export const BorradorFicha = z.object({
  tramite: z.object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    nombre: z.string().min(3).max(120),
    nombre_busqueda: z.string().min(3).max(120),
    resumen: z.string().min(10).max(400),
    sinonimos: z.array(z.string().max(80)).max(20),
    /** Slugs de temas existentes; el primero es el principal. */
    temas: z.array(z.string()).min(1).max(4),
    /** Temas que no existen todavía y la IA propone crear. */
    temas_propuestos: z
      .array(z.object({ slug: z.string(), nombre: z.string(), padre: z.string().nullable() }))
      .max(2)
      .default([]),
  }),
  jurisdiccion_id: z.string().min(1),
  organismo: z.object({ nombre: z.string().min(1), sigla: z.string().nullable(), web: urlOficial.nullable() }),
  contenido: ContenidoFicha,
  costos: z.array(Costo),
  oficinas: z.array(OficinaEntrada).max(50),
  fuentes: z.array(Fuente).min(1),
  /** Datos que la IA no pudo confirmar en una fuente oficial. */
  sin_confirmar: z.array(z.string()).default([]),
});
export type BorradorFicha = z.infer<typeof BorradorFicha>;

/** Controles automáticos previos a la cola de revisión. Devuelve los problemas encontrados. */
export function chequearBorrador(b: BorradorFicha, anterior?: { costos: Costo[] }): string[] {
  const problemas: string[] = [];
  const cubiertos = new Set(b.fuentes.flatMap((f) => f.bloques));
  for (const bloque of ['quien', 'requisitos', 'pasos'] as const) {
    if (!cubiertos.has(bloque)) problemas.push(`El bloque "${bloque}" no tiene fuente`);
  }
  if (b.costos.length > 0 && !cubiertos.has('costo')) problemas.push('Los costos no tienen fuente');
  if (anterior) {
    for (const c of b.costos) {
      const viejo = anterior.costos.find((x) => x.modalidad === c.modalidad);
      if (viejo?.monto_centavos && c.monto_centavos && Math.abs(c.monto_centavos - viejo.monto_centavos) / viejo.monto_centavos > 0.5) {
        problemas.push(`El costo "${c.modalidad}" cambia más de 50 %`);
      }
    }
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------------------------

export const BorradorTema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  nombre: z.string().min(2).max(60),
  descripcion: z.string().max(200),
  tipo: z.enum(['tema', 'situacion']),
  /** Slug del tema padre para un subtema. */
  padre: z.string().nullable(),
});
export type BorradorTema = z.infer<typeof BorradorTema>;

// ---------------------------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------------------------

export const EntradaCatalogo = z.object({
  url: urlOficial,
  nombre_oficial: z.string().min(3).max(300),
  jurisdiccion_id: z.string().min(1),
  organismo: z.string().nullable(),
  temas_sugeridos: z.array(z.string()).max(4).default([]),
  portal: z.string().min(1),
});
export type EntradaCatalogo = z.infer<typeof EntradaCatalogo>;

// ---------------------------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------------------------

export const NuevoReporte = z
  .object({
    variante_id: z.number().int().positive(),
    bloque: Bloque,
    descripcion: z.string().min(5).max(1000),
    valor_correcto: z.string().max(500).nullable(),
    prueba_url: z.string().url().nullable(),
    email: z.string().email().nullable(),
    turnstile_token: z.string().min(1),
  });
export type NuevoReporte = z.infer<typeof NuevoReporte>;
