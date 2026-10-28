/**
 * Capa de datos de Tramitando.
 *
 * Las páginas solo importan desde este archivo: tipos y funciones async. Las funciones leen de la
 * API (`apps/api`) usando el service binding en producción y `API_URL` en desarrollo. Si
 * `DATOS_EJEMPLO=1`, muestran los datos de `datos-ejemplo.ts` sin llamar a la API.
 *
 * Modelo (documento de definición): el trámite genérico existe una sola vez y cada jurisdicción
 * donde se hace tiene su variante, que es la ficha publicada. Costos, fuentes y verificaciones
 * cuelgan de la variante. Si un municipio no tiene variante propia se muestra la del nivel de arriba.
 */
import * as ejemplo from './datos-ejemplo';
import { formatoMonto } from './formato';
import {
  esErrorApi,
  pedirApi,
  conParametros,
  type BloqueApi,
  type BusquedaApi,
  type FichaApi,
  type FuenteApi,
  type JurisdiccionApi,
  type NivelApi,
  type OficinaApi,
  type OrganismoApi,
  type OrganismoDetalleApi,
  type SitemapApi,
  type TarjetaApi,
  type TemaApi,
  type TemaDetalleApi,
  type TemaDeTramiteApi,
  type TemasApi,
  type TramiteApi,
  type TramiteDetalleApi,
  type VarianteApi,
} from './api';

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

export type Nivel = 'nacion' | 'provincia' | 'municipio';

export interface Jurisdiccion {
  /** Slug único dentro de su nivel y su padre: "santa-fe", "rosario". */
  slug: string;
  nombre: string;
  nivel: Nivel;
  /** Slug de la provincia, solo para municipios. */
  provincia?: string;
  /** [lat, lng] aproximado, para sugerir la ubicación con el GPS del navegador. */
  centro?: [number, number];
}

export interface Categoria {
  slug: string;
  nombre: string;
  descripcion: string;
  icono: string;
}

/** Un tema de la taxonomía, con sus subtemas y la cantidad de trámites publicados. */
export interface Tema extends Categoria {
  cantidad: number;
  subtemas: Tema[];
  /** true para las situaciones de vida ("Nació mi hijo"). */
  esSituacion?: boolean;
}

export interface IndiceTemas {
  temas: Tema[];
  situaciones: Tema[];
}

/** Contenido de `/temas/[slug]` y `/situaciones/[slug]`. */
export interface PaginaTema {
  tema: Tema;
  /** Tema padre cuando la página es de un subtema. */
  padre?: { slug: string; nombre: string };
  subtemas: Tema[];
  tramites: TarjetaTramite[];
  total: number;
  pagina: number;
  paginas: number;
}

export interface Tramite {
  slug: string;
  /** Como lo busca la gente: "Renovación de DNI". */
  nombre: string;
  /** Verbo para el título SEO: "Renovar el DNI". */
  nombreBusqueda: string;
  categoria: string;
  /** Una o dos oraciones de para qué sirve, válidas para todas las variantes. */
  resumen: string;
  /** Palabras con las que también se busca, para el buscador. */
  sinonimos: string[];
  relacionados: string[];
  /** Posición en "Más buscados" (menor = más arriba). */
  popularidad?: number;
}

export interface Organismo {
  slug: string;
  nombre: string;
  sigla?: string;
  descripcion: string;
  jurisdiccion: { provincia?: string; municipio?: string };
  web: string;
}

export interface Oficina {
  id: string;
  organismo: string;
  nombre: string;
  direccion: string;
  localidad: string;
  /** "Lunes a viernes de 8 a 14 h". */
  horario: string;
  mapaUrl: string;
  fuente: string;
}

/** Bloques de la ficha, en el orden del documento. Se usan en fuentes y en el formulario de reporte. */
export const BLOQUES = {
  resumen: 'Resumen',
  costo: 'Cuánto cuesta',
  plazo: 'Cuánto tarda',
  quien: 'Quién puede hacerlo',
  requisitos: 'Qué necesitás',
  pasos: 'Paso a paso',
  oficinas: 'Dónde se hace',
  consejos: 'Tené en cuenta',
} as const;
export type Bloque = keyof typeof BLOQUES;

export interface Fuente {
  id: string;
  titulo: string;
  url: string;
  /** Bloques que respalda esta fuente. */
  respalda: Bloque[];
  /** Fecha ISO (AAAA-MM-DD) en que se verificó el dato contra la fuente. */
  verificadaEl: string;
}

export interface Costo {
  /** "Trámite normal", "Exprés", "Online". */
  concepto: string;
  /** En pesos. 0 = gratis. */
  monto: number;
  /** Fecha ISO desde la que rige el monto. */
  vigenteDesde: string;
  fuente: string;
}

export interface ItemRequisito {
  id: string;
  texto: string;
  aclaracion?: string;
  fuente: string;
}

export interface Paso {
  texto: string;
  enlace?: { texto: string; url: string };
}

export type EstadoVerificacion = 'verificado' | 'desactualizado' | 'sin-datos';

export interface Verificacion {
  /** Fecha ISO de la última verificación completa de la ficha. */
  fecha: string;
  /** Fecha ISO límite: si pasa sin verificar, la ficha pasa sola a "Puede estar desactualizado". */
  proximaRevision: string;
  /** Hay un reporte de usuario aceptado o un cambio detectado pendiente. */
  enRevision?: boolean;
}

export interface Variante {
  id: string;
  tramite: string;
  /** Dónde vive la variante. Sin provincia = Nación. */
  provincia?: string;
  municipio?: string;
  organismo: string;
  resumen?: string;
  /** Vacío si el costo no se puede dar (por ejemplo, lo fija cada municipio); ver `costoNota`. */
  costos: Costo[];
  /** Aclaración cuando no hay costos: "Lo fija cada municipio". */
  costoNota?: string;
  mediosDePago: string[];
  plazo: { resolucion: string; entrega?: string; fuente: string };
  quienPuede: string[];
  requisitos: ItemRequisito[];
  pasos: { online?: Paso[]; presencial?: Paso[]; turno?: string; turnoUrl?: string };
  /** Página oficial donde se hace el trámite (la fuente principal de la ficha). */
  urlOficial?: string;
  oficinas: string[];
  consejos: string[];
  fuentes: Fuente[];
  verificacion: Verificacion;
}

// Resultados que arman las funciones de abajo -----------------------------------------------------

export interface Ubicacion {
  provincia?: Jurisdiccion;
  municipio?: Jurisdiccion;
}

export interface TarjetaTramite {
  url: string;
  tramite: Tramite;
  /** Chip de la tarjeta: "Nación · RENAPER", "Municipio de Rosario · Santa Fe". */
  jurisdiccion: string;
  organismo: string;
  costo: string;
  plazo: string;
  estado: EstadoVerificacion;
  fechaVerificacion?: string;
  categoria: Categoria;
}

export interface Ficha {
  tramite: Tramite;
  categoria: Categoria;
  /** Lugar pedido en la URL. */
  pedido: Ubicacion;
  /** Variante que se muestra. Puede ser de un nivel de arriba (`heredada`). */
  variante: Variante;
  heredada: boolean;
  /** Dónde vive la variante que se muestra. */
  lugarVariante: Ubicacion;
  organismo: Organismo;
  oficinas: Oficina[];
  relacionados: TarjetaTramite[];
  estado: EstadoVerificacion;
  /** false para fichas municipales sin datos propios (noindex). */
  indexable: boolean;
  url: string;
  /** URL de la versión de la que se hereda, para enlazarla. */
  urlVariante: string;
}

/** Raíz de un trámite sin variante nacional: lista de lugares donde hay ficha. */
export interface IndiceTramite {
  tramite: Tramite;
  categoria: Categoria;
  lugares: TarjetaTramite[];
}

// ---------------------------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------------------------

const hoyISO = () => new Date().toISOString().slice(0, 10);

/** Mismo tamaño de página que usa la API para los temas. */
const TRAMITES_POR_PAGINA = 24;

export function estadoDe(v: Verificacion, hoy = hoyISO()): EstadoVerificacion {
  if (v.enRevision || v.proximaRevision < hoy) return 'desactualizado';
  return 'verificado';
}

export function urlFicha(tramite: string, provincia?: string, municipio?: string): string {
  return ['/tramites', tramite, provincia, provincia && municipio].filter(Boolean).join('/');
}

/** En producción el middleware carga `API`. En desarrollo se usa `API_URL`. */
export const USA_DATOS_DE_EJEMPLO = import.meta.env.DATOS_EJEMPLO === '1';

const CATEGORIA_OTROS: Categoria = {
  slug: 'otros',
  nombre: 'Otros',
  descripcion: '',
  icono: 'file-text',
};

const BLOQUE_API_A_WEB: Record<BloqueApi, Bloque> = {
  resumen: 'resumen',
  costo: 'costo',
  plazo: 'plazo',
  quien: 'quien',
  requisitos: 'requisitos',
  pasos: 'pasos',
  donde: 'oficinas',
  consejos: 'consejos',
};

const fechaISO = (valor: string | null | undefined): string => (valor ?? new Date().toISOString()).slice(0, 10);

function categoriaDesdeTema(tema: Pick<TemaApi, 'slug' | 'nombre' | 'descripcion' | 'icono'>): Categoria {
  return {
    slug: tema.slug,
    nombre: tema.nombre,
    descripcion: tema.descripcion,
    icono: tema.icono ?? 'file-text',
  };
}

function temaDesdeApi(tema: TemaApi): Tema {
  return { ...categoriaDesdeTema(tema), cantidad: tema.cantidad_tramites, subtemas: [] };
}

interface Contexto {
  categorias: Map<string, Categoria>;
}

function contextoDeTemas(datos: TemasApi): Contexto {
  const categorias = new Map<string, Categoria>();
  const todos = [...datos.temas, ...datos.temas.flatMap((tema) => tema.subtemas), ...datos.situaciones];
  for (const tema of todos) categorias.set(tema.slug, categoriaDesdeTema(tema));
  return { categorias };
}

async function contextoDeApi(): Promise<Contexto> {
  return contextoDeTemas(await pedirApi<TemasApi>('/v1/temas'));
}

function categoriaDeTemas(temas: TemaDeTramiteApi[], contexto: Contexto): Categoria {
  const principal = temas.find((tema) => tema.principal) ?? temas[0];
  if (!principal) return CATEGORIA_OTROS;
  return contexto.categorias.get(principal.slug) ?? CATEGORIA_OTROS;
}

function categoriaDeSlug(slug: string, contexto: Contexto): Categoria {
  return contexto.categorias.get(slug) ?? CATEGORIA_OTROS;
}

function jurisdiccionDesdeApi(j: JurisdiccionApi): Jurisdiccion {
  return {
    slug: j.slug,
    nombre: j.nombre,
    nivel: j.nivel,
    provincia: j.nivel === 'municipio' ? j.padre?.slug : undefined,
    centro: j.lat !== null && j.lng !== null ? [j.lat, j.lng] : undefined,
  };
}

function nombreLugar(j: { nivel: NivelApi; nombre: string; padre?: { nombre: string } | null }): string {
  if (j.nivel === 'municipio') return `Municipio de ${j.nombre} · ${j.padre?.nombre ?? ''}`.trim();
  return j.nivel === 'nacion' ? 'Nación' : j.nombre;
}

function chipLugar(j: { nivel: NivelApi; nombre: string; padre?: { nombre: string } | null }, organismo: { sigla: string | null } | null): string {
  if (j.nivel === 'municipio') {
    return j.padre?.nombre ? `Municipio de ${j.nombre} · ${j.padre.nombre}` : `Municipio de ${j.nombre}`;
  }
  const lugar = j.nivel === 'nacion' ? 'Nación' : j.nombre;
  return organismo?.sigla ? `${lugar} · ${organismo.sigla}` : lugar;
}

function tramiteDesdeApi(t: TramiteApi | TarjetaApi, categoria: Categoria): Tramite {
  return {
    slug: t.slug,
    nombre: t.nombre,
    nombreBusqueda: t.nombre_busqueda,
    categoria: categoria.slug,
    resumen: t.resumen,
    sinonimos: t.sinonimos,
    relacionados: [],
    popularidad: t.popularidad ?? undefined,
  };
}

function organismoDesdeApi(organismo: OrganismoApi | null, pedido: Ubicacion): Organismo {
  const j = organismo?.jurisdiccion;
  const provincia =
    j?.nivel === 'provincia'
      ? j.slug
      : j?.nivel === 'municipio'
        ? j.padre?.slug ?? pedido.provincia?.slug
        : undefined;
  const municipio = j?.nivel === 'municipio' ? j.slug : undefined;
  return {
    slug: organismo?.slug ?? 'organismo-a-confirmar',
    nombre: organismo?.nombre ?? 'Organismo a confirmar',
    sigla: organismo?.sigla ?? undefined,
    descripcion: organismo?.descripcion ?? '',
    jurisdiccion: { provincia, municipio },
    web: organismo?.web ?? '',
  };
}

/** Link de Google Maps (lo que la mayoría usa en el celular): por coordenadas si las hay, si no por dirección. */
function mapaOficina(oficina: OficinaApi): string {
  const consulta = oficina.lat !== null && oficina.lng !== null
    ? `${oficina.lat},${oficina.lng}`
    : `${oficina.direccion}, ${oficina.localidad}, Argentina`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

function oficinaDesdeApi(oficina: OficinaApi, organismo: string): Oficina {
  return {
    id: String(oficina.id),
    organismo,
    nombre: oficina.nombre,
    direccion: oficina.direccion,
    localidad: oficina.localidad,
    horario: oficina.horario ?? '',
    mapaUrl: mapaOficina(oficina),
    fuente: oficina.fuente_url ?? '',
  };
}

function fuentesDesdeApi(registro: Record<string, FuenteApi[]>): Fuente[] {
  const porId = new Map<number, Fuente>();
  for (const [bloque, fuentes] of Object.entries(registro)) {
    const bloqueWeb = BLOQUE_API_A_WEB[bloque as BloqueApi];
    if (!bloqueWeb) continue;
    for (const fuente of fuentes) {
      let acumulada = porId.get(fuente.id);
      if (!acumulada) {
        acumulada = {
          id: String(fuente.id),
          titulo: fuente.titulo ?? new URL(fuente.url).hostname,
          url: fuente.url,
          respalda: [],
          verificadaEl: fechaISO(fuente.consultada_en),
        };
        porId.set(fuente.id, acumulada);
      }
      if (!acumulada.respalda.includes(bloqueWeb)) acumulada.respalda.push(bloqueWeb);
    }
  }
  return [...porId.values()];
}

function verificacionDesdeApi(variante: VarianteApi): Verificacion {
  const fecha = fechaISO(variante.verificado_en ?? variante.actualizado_en);
  return {
    fecha,
    proximaRevision: fechaISO(variante.proxima_revision ?? variante.verificado_en ?? variante.actualizado_en),
    enRevision: variante.verificacion === 'revisar',
  };
}

function lugarVarianteDesdeApi(variante: VarianteApi, pedido: Ubicacion): Ubicacion {
  if (variante.jurisdiccion.nivel === 'nacion') return {};
  if (variante.jurisdiccion.nivel === 'provincia') {
    return {
      provincia: {
        slug: variante.jurisdiccion.slug,
        nombre: variante.jurisdiccion.nombre,
        nivel: 'provincia',
      },
    };
  }
  return {
    provincia: pedido.provincia,
    municipio: {
      slug: variante.jurisdiccion.slug,
      nombre: variante.jurisdiccion.nombre,
      nivel: 'municipio',
      provincia: pedido.provincia?.slug,
    },
  };
}

function urlDeVariante(tramite: string, variante: VarianteApi, pedido: Ubicacion): string {
  const lugar = lugarVarianteDesdeApi(variante, pedido);
  return urlFicha(tramite, lugar.provincia?.slug, lugar.municipio?.slug);
}

function costosDesdeApi(variante: VarianteApi): Costo[] {
  return variante.costos.map((costo) => ({
    concepto: costo.modalidad,
    monto: costo.gratis ? 0 : (costo.monto_centavos ?? 0) / 100,
    vigenteDesde: fechaISO(costo.vigente_desde ?? variante.actualizado_en),
    fuente: costo.fuente_url ?? '',
  }));
}

function resumenCostoApi(costos: VarianteApi['costos']): string {
  if (costos.length === 0) return 'Varía según el lugar';
  if (costos.every((costo) => costo.gratis || costo.monto_centavos === 0)) return 'Gratis';
  const montos = costos.map((costo) => (costo.gratis ? 0 : (costo.monto_centavos ?? 0) / 100));
  const principal = montos[0] ?? 0;
  const hayMasCaros = montos.slice(1).some((monto) => monto > principal);
  const hayMasBaratos = montos.slice(1).some((monto) => monto < principal);
  return hayMasCaros && !hayMasBaratos ? `Desde ${formatoMonto(principal)}` : formatoMonto(principal);
}

function varianteDesdeApi(ficha: FichaApi, oficinas: Oficina[], pedido: Ubicacion): Variante {
  const { variante } = ficha;
  const contenido = variante.contenido;
  const fuentes = fuentesDesdeApi(variante.fuentes);
  const fuenteDe = (bloque: Bloque): string => fuentes.find((fuente) => fuente.respalda.includes(bloque))?.id ?? '';
  const lugar = lugarVarianteDesdeApi(variante, pedido);

  return {
    id: String(variante.id),
    tramite: ficha.tramite.slug,
    provincia: lugar.provincia?.slug,
    municipio: lugar.municipio?.slug,
    organismo: variante.organismo?.slug ?? '',
    costos: costosDesdeApi(variante),
    mediosDePago: [],
    plazo: {
      resolucion: contenido?.plazo?.trim() || 'No informado',
      fuente: fuenteDe('plazo'),
    },
    quienPuede: contenido?.quien_puede ?? [],
    requisitos: (contenido?.requisitos ?? []).map((requisito, indice) => ({
      id: `requisito-${indice + 1}`,
      texto: requisito.texto,
      aclaracion: requisito.aclaracion ?? undefined,
      fuente: fuenteDe('requisitos'),
    })),
    pasos: {
      online: contenido?.pasos_online.length ? contenido.pasos_online.map((paso) => ({ texto: paso.texto })) : undefined,
      presencial: contenido?.pasos_presencial.length ? contenido.pasos_presencial.map((paso) => ({ texto: paso.texto })) : undefined,
      turno:
        contenido?.requiere_turno === true
          ? contenido.turno_url
            ? 'Antes de ir, sacá turno online.'
            : 'Hace falta sacar turno antes de ir.'
          : undefined,
      turnoUrl: contenido?.requiere_turno === true ? contenido.turno_url ?? undefined : undefined,
    },
    urlOficial: fuentes[0]?.url,
    oficinas: oficinas.map((oficina) => oficina.id),
    consejos: contenido?.consejos ?? [],
    fuentes,
    verificacion: verificacionDesdeApi(variante),
  };
}

function lugarDeTarjeta(
  variante: { jurisdiccion: { nivel: NivelApi; slug: string; nombre: string }; organismo: { sigla: string | null } | null } | null,
  pedido: Ubicacion,
): string {
  if (!variante) return 'Nación';
  const j = variante.jurisdiccion;
  if (j.nivel === 'municipio') return chipLugar({ nivel: 'municipio', nombre: j.nombre, padre: pedido.provincia }, variante.organismo);
  return chipLugar({ nivel: j.nivel, nombre: j.nombre }, variante.organismo);
}

function tarjetaDesdeFicha(ficha: FichaApi, contexto: Contexto, pedido: Ubicacion): TarjetaTramite {
  const categoria = categoriaDeTemas(ficha.temas, contexto);
  const tramite = tramiteDesdeApi(ficha.tramite, categoria);
  const variante = ficha.variante;
  const verificacion = verificacionDesdeApi(variante);
  return {
    url: urlDeVariante(tramite.slug, variante, pedido),
    tramite,
    jurisdiccion: chipLugar(variante.jurisdiccion, variante.organismo),
    organismo: variante.organismo?.sigla ?? variante.organismo?.nombre ?? 'Organismo a confirmar',
    costo: resumenCostoApi(variante.costos),
    plazo: variante.contenido?.plazo ?? 'No informado',
    estado: estadoDe(verificacion),
    fechaVerificacion: verificacion.fecha,
    categoria,
  };
}

function tarjetaDeRespaldo(tarjeta: TarjetaApi, pedido: Ubicacion, categoria?: Categoria): TarjetaTramite {
  const variante = tarjeta.variante;
  const cat = categoria ?? CATEGORIA_OTROS;
  if (!variante) {
    return {
      url: urlFicha(tarjeta.slug),
      tramite: tramiteDesdeApi(tarjeta, cat),
      jurisdiccion: 'Nación',
      organismo: 'Organismo a confirmar',
      costo: 'Consultá el costo',
      plazo: 'Consultá el plazo',
      estado: 'sin-datos',
      categoria: cat,
    };
  }

  const j = variante.jurisdiccion;
  const provincia = j.nivel === 'municipio' ? pedido.provincia?.slug : j.nivel === 'provincia' ? j.slug : undefined;
  const municipio = j.nivel === 'municipio' ? j.slug : undefined;
  return {
    url: urlFicha(tarjeta.slug, provincia, municipio),
    tramite: tramiteDesdeApi(tarjeta, cat),
    jurisdiccion: lugarDeTarjeta(variante, pedido),
    organismo: variante.organismo?.sigla ?? variante.organismo?.nombre ?? 'Organismo a confirmar',
    costo: 'Consultá el costo',
    plazo: 'Según el lugar',
    estado: variante.verificacion === 'revisar' ? 'desactualizado' : 'verificado',
    fechaVerificacion: fechaISO(variante.actualizado_en),
    categoria: cat,
  };
}

async function pedirFicha(tramite: string, prov?: string, muni?: string): Promise<FichaApi> {
  let slug = tramite;
  for (let intento = 0; intento < 2; intento += 1) {
    const respuesta = await pedirApi<FichaApi | { redirect: string }>(
      conParametros(`/v1/fichas/${encodeURIComponent(slug)}`, { prov, muni }),
    );
    if ('redirect' in respuesta) {
      slug = respuesta.redirect;
      continue;
    }
    return respuesta;
  }
  throw new Error(`No pudimos resolver el trámite ${tramite}.`);
}

async function pedirTramite(slug: string): Promise<TramiteDetalleApi | null> {
  let actual = slug;
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const respuesta = await pedirApi<TramiteDetalleApi | { redirect: string }>(`/v1/tramites/${encodeURIComponent(actual)}`);
      if ('redirect' in respuesta) {
        actual = respuesta.redirect;
        continue;
      }
      return respuesta;
    } catch (error) {
      if (esErrorApi(error, 'tramite_no_encontrado')) return null;
      throw error;
    }
  }
  return null;
}

async function fichaParaTarjeta(slug: string, pedido: Ubicacion): Promise<FichaApi | null> {
  try {
    return await pedirFicha(slug, pedido.provincia?.slug, pedido.municipio?.slug);
  } catch (error) {
    if (
      esErrorApi(error, 'ficha_no_encontrada') ||
      esErrorApi(error, 'ubicacion_no_encontrada') ||
      esErrorApi(error, 'tramite_no_encontrado')
    ) {
      return null;
    }
    throw error;
  }
}

async function tarjetaDesdeApi(tarjeta: TarjetaApi, pedido: Ubicacion, contexto: Contexto, categoria?: Categoria): Promise<TarjetaTramite> {
  const ficha = await fichaParaTarjeta(tarjeta.slug, pedido);
  return ficha ? tarjetaDesdeFicha(ficha, contexto, pedido) : tarjetaDeRespaldo(tarjeta, pedido, categoria);
}

function tarjetasDesdeApi(tarjetas: TarjetaApi[], pedido: Ubicacion, contexto: Contexto, categoria?: Categoria): Promise<TarjetaTramite[]> {
  return Promise.all(tarjetas.map((tarjeta) => tarjetaDesdeApi(tarjeta, pedido, contexto, categoria)));
}

interface TemaDetallePedido {
  tipo: 'detalle';
  datos: TemaDetalleApi;
}

interface TemaRedirigido {
  tipo: 'redirect';
  slug: string;
}

async function pedirTemaDetalle(
  slug: string,
  prov?: string,
  muni?: string,
  pagina?: number,
): Promise<TemaDetallePedido | TemaRedirigido | null> {
  try {
    const respuesta = await pedirApi<TemaDetalleApi | { redirect: string }>(
      conParametros(`/v1/temas/${encodeURIComponent(slug)}`, { prov, muni, pagina }),
    );
    return 'redirect' in respuesta
      ? { tipo: 'redirect', slug: respuesta.redirect }
      : { tipo: 'detalle', datos: respuesta };
  } catch (error) {
    if (esErrorApi(error, 'tema_no_encontrado')) return null;
    throw error;
  }
}

async function pedirTema(slug: string, prov?: string, muni?: string): Promise<TemaDetalleApi | null> {
  let actual = slug;
  for (let intento = 0; intento < 2; intento += 1) {
    const respuesta = await pedirTemaDetalle(actual, prov, muni);
    if (!respuesta) return null;
    if (respuesta.tipo === 'detalle') return respuesta.datos;
    actual = respuesta.slug;
  }
  return null;
}

function ubicacionDeJurisdiccion(j: JurisdiccionApi): Ubicacion {
  if (j.nivel === 'nacion') return {};
  if (j.nivel === 'provincia') return { provincia: jurisdiccionDesdeApi(j) };
  return {
    provincia: j.padre
      ? { slug: j.padre.slug, nombre: j.padre.nombre, nivel: 'provincia' }
      : undefined,
    municipio: jurisdiccionDesdeApi(j),
  };
}

async function tarjetasDeJurisdicciones(detalle: TramiteDetalleApi, contexto: Contexto): Promise<TarjetaTramite[]> {
  const categoria = categoriaDeTemas(detalle.temas, contexto);
  return Promise.all(
    detalle.jurisdicciones.map(async (entrada) => {
      const pedido = ubicacionDeJurisdiccion(entrada.jurisdiccion);
      const ficha = await fichaParaTarjeta(detalle.tramite.slug, pedido);
      if (ficha) return tarjetaDesdeFicha(ficha, contexto, pedido);
      const tarjeta: TarjetaApi = {
        id: detalle.tramite.id,
        slug: detalle.tramite.slug,
        nombre: detalle.tramite.nombre,
        nombre_busqueda: detalle.tramite.nombre_busqueda,
        resumen: detalle.tramite.resumen,
        sinonimos: detalle.tramite.sinonimos,
        popularidad: detalle.tramite.popularidad,
        variante: {
          id: entrada.variante_id,
          jurisdiccion: {
            id: entrada.jurisdiccion.id,
            nivel: entrada.jurisdiccion.nivel,
            nombre: entrada.jurisdiccion.nombre,
            slug: entrada.jurisdiccion.slug,
          },
          organismo: entrada.organismo,
          verificacion: entrada.verificacion,
          actualizado_en: entrada.actualizado_en,
        },
      };
      return tarjetaDeRespaldo(tarjeta, pedido, categoria);
    }),
  );
}

async function relacionadosDe(categoria: string, tramite: string, pedido: Ubicacion, contexto: Contexto): Promise<TarjetaTramite[]> {
  if (categoria === CATEGORIA_OTROS.slug) return [];
  try {
    const detalle = await pedirTema(categoria, pedido.provincia?.slug, pedido.municipio?.slug);
    if (!detalle) return [];
    const otros = detalle.tramites.filter((t) => t.slug !== tramite).slice(0, 3);
    return await tarjetasDesdeApi(otros, pedido, contexto, categoriaDeSlug(categoria, contexto));
  } catch {
    return [];
  }
}

async function fichaDesdeApi(datos: FichaApi, pedido: Ubicacion, contexto: Contexto): Promise<Ficha> {
  const categoria = categoriaDeTemas(datos.temas, contexto);
  const tramite = tramiteDesdeApi(datos.tramite, categoria);
  const oficinas = datos.variante.oficinas.map((oficina) => oficinaDesdeApi(oficina, datos.variante.organismo?.slug ?? ''));
  const variante = varianteDesdeApi(datos, oficinas, pedido);
  const lugarVariante = lugarVarianteDesdeApi(datos.variante, pedido);
  const verificacion = variante.verificacion;

  return {
    tramite,
    categoria,
    pedido,
    variante,
    heredada: datos.heredada_de !== null,
    lugarVariante,
    organismo: organismoDesdeApi(datos.variante.organismo, pedido),
    oficinas,
    relacionados: await relacionadosDe(categoria.slug, tramite.slug, pedido, contexto),
    estado: estadoDe(verificacion),
    indexable: datos.indexable,
    url: urlFicha(tramite.slug, pedido.provincia?.slug, pedido.municipio?.slug),
    urlVariante: urlDeVariante(tramite.slug, datos.variante, pedido),
  };
}

// ---------------------------------------------------------------------------------------------
// Utilidades de los datos de ejemplo
// ---------------------------------------------------------------------------------------------

const provinciaEjemplo = (slug?: string) =>
  slug ? ejemplo.jurisdicciones.find((j) => j.nivel === 'provincia' && j.slug === slug) : undefined;
const municipioEjemplo = (prov?: string, slug?: string) =>
  prov && slug
    ? ejemplo.jurisdicciones.find((j) => j.nivel === 'municipio' && j.provincia === prov && j.slug === slug)
    : undefined;

function nombreLugarEjemplo(v: Pick<Variante, 'provincia' | 'municipio'>): string {
  if (v.municipio) {
    const m = municipioEjemplo(v.provincia, v.municipio);
    return `Municipio de ${m?.nombre} · ${provinciaEjemplo(v.provincia)?.nombre}`;
  }
  if (v.provincia) return provinciaEjemplo(v.provincia)?.nombre ?? '';
  return 'Nación';
}

function resumenCostoEjemplo(v: Variante): string {
  if (v.costos.length === 0) return 'Varía según el lugar';
  if (v.costos.every((c) => c.monto === 0)) return 'Gratis';
  const principal = v.costos[0].monto;
  const hayMasCaros = v.costos.slice(1).some((c) => c.monto > principal);
  const hayMasBaratos = v.costos.slice(1).some((c) => c.monto < principal);
  return hayMasCaros && !hayMasBaratos ? `Desde ${formatoMonto(principal)}` : formatoMonto(principal);
}

function tarjetaEjemplo(v: Variante): TarjetaTramite {
  const tramite = ejemplo.tramites.find((t) => t.slug === v.tramite)!;
  const org = ejemplo.organismos.find((o) => o.slug === v.organismo)!;
  const categoria = ejemplo.categorias.find((c) => c.slug === tramite.categoria)!;
  return {
    url: urlFicha(v.tramite, v.provincia, v.municipio),
    tramite,
    jurisdiccion: v.municipio || !org.sigla ? nombreLugarEjemplo(v) : `${nombreLugarEjemplo(v)} · ${org.sigla}`,
    organismo: org.sigla ?? org.nombre,
    costo: resumenCostoEjemplo(v),
    plazo: v.plazo.resolucion,
    estado: estadoDe(v.verificacion),
    fechaVerificacion: v.verificacion.fecha,
    categoria,
  };
}

function varianteMasCercanaEjemplo(tramite: string, prov?: string, muni?: string): Variante | undefined {
  const vs = ejemplo.variantes.filter((v) => v.tramite === tramite);
  return (
    (muni && vs.find((v) => v.provincia === prov && v.municipio === muni)) ||
    (prov && vs.find((v) => v.provincia === prov && !v.municipio)) ||
    vs.find((v) => !v.provincia)
  ) || undefined;
}

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ');

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'para', 'por', 'un', 'una', 'mi', 'como', 'cuanto', 'sale', 'cuesta', 'que', 'y', 'a', 'sacar', 'hacer', 'tramite']);

function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function coincide(palabra: string, vocabulario: string[]): boolean {
  return vocabulario.some(
    (v) => v.startsWith(palabra) || (palabra.length >= 4 && distancia(palabra, v) <= (palabra.length >= 7 ? 2 : 1)),
  );
}

// ---------------------------------------------------------------------------------------------
// API pública de la capa de datos
// ---------------------------------------------------------------------------------------------

export async function listarCategorias(): Promise<(Categoria & { cantidad: number; ejemplos: string[] })[]> {
  if (USA_DATOS_DE_EJEMPLO) {
    return ejemplo.categorias.map((c) => {
      const ts = ejemplo.tramites.filter((t) => t.categoria === c.slug);
      return { ...c, cantidad: ts.length, ejemplos: ts.map((t) => t.nombre) };
    });
  }

  const datos = await pedirApi<TemasApi>('/v1/temas');
  return datos.temas.map((tema) => ({
    ...categoriaDesdeTema(tema),
    cantidad: tema.cantidad_tramites,
    ejemplos: [],
  }));
}

function temasDesdeApi(datos: TemasApi): IndiceTemas {
  return {
    temas: datos.temas.map((tema) => ({ ...temaDesdeApi(tema), subtemas: tema.subtemas.map(temaDesdeApi) })),
    situaciones: datos.situaciones.map(temaDesdeApi),
  };
}

/**
 * Todos los temas con sus subtemas y, aparte, las situaciones de vida. Con `portada` devuelve solo
 * los temas marcados para la portada, pero todas las situaciones (que tienen su propia fila).
 */
export async function listarTemas(opciones: { portada?: boolean } = {}): Promise<IndiceTemas> {
  if (USA_DATOS_DE_EJEMPLO) {
    return {
      temas: ejemplo.categorias.map((categoria) => ({
        ...categoria,
        cantidad: ejemplo.tramites.filter((tramite) => tramite.categoria === categoria.slug).length,
        subtemas: [],
      })),
      situaciones: [],
    };
  }

  if (opciones.portada) {
    const [portadaDatos, todos] = await Promise.all([
      pedirApi<TemasApi>('/v1/temas?portada=1'),
      pedirApi<TemasApi>('/v1/temas'),
    ]);
    return {
      temas: temasDesdeApi(portadaDatos).temas,
      situaciones: temasDesdeApi(todos).situaciones,
    };
  }

  return temasDesdeApi(await pedirApi<TemasApi>('/v1/temas'));
}

/**
 * Página de un tema, subtema o situación. Sigue los slugs históricos: si la API devuelve un
 * `redirect`, la página responde 301.
 */
export async function obtenerTema(
  slug: string,
  lugar: Ubicacion = {},
  pagina = 1,
): Promise<{ tipo: 'redirect'; slug: string } | { tipo: 'tema'; datos: PaginaTema } | null> {
  const paginaSegura = Number.isFinite(pagina) && pagina >= 1 ? Math.floor(pagina) : 1;

  if (USA_DATOS_DE_EJEMPLO) {
    const categoria = ejemplo.categorias.find((c) => c.slug === slug);
    if (!categoria) return null;
    const tramites = ejemplo.tramites
      .filter((tramite) => tramite.categoria === slug)
      .sort((a, b) => (a.popularidad ?? 1_000_000) - (b.popularidad ?? 1_000_000))
      .flatMap((tramite) =>
        ejemplo.variantes.filter((variante) => variante.tramite === tramite.slug).map(tarjetaEjemplo),
      );
    const total = tramites.length;
    const paginas = Math.max(1, Math.ceil(total / TRAMITES_POR_PAGINA));
    const desde = (paginaSegura - 1) * TRAMITES_POR_PAGINA;
    return {
      tipo: 'tema',
      datos: {
        tema: { ...categoria, cantidad: total, subtemas: [] },
        subtemas: [],
        tramites: tramites.slice(desde, desde + TRAMITES_POR_PAGINA),
        total,
        pagina: paginaSegura,
        paginas,
      },
    };
  }

  const respuesta = await pedirTemaDetalle(
    slug,
    lugar.provincia?.slug,
    lugar.municipio?.slug,
    paginaSegura,
  );
  if (!respuesta) return null;
  if (respuesta.tipo === 'redirect') return respuesta;

  const { datos } = respuesta;
  const contexto = await contextoDeApi();
  const tema: Tema = {
    ...categoriaDesdeTema(datos.tema),
    cantidad: datos.total,
    subtemas: [],
    esSituacion: datos.tema.tipo === 'situacion',
  };

  return {
    tipo: 'tema',
    datos: {
      tema,
      padre: datos.tema.padre ?? undefined,
      subtemas: datos.subtemas.map(temaDesdeApi),
      tramites: await tarjetasDesdeApi(datos.tramites, lugar, contexto, tema),
      total: datos.total,
      pagina: datos.pagina,
      paginas: datos.paginas,
    },
  };
}

export async function obtenerCategoria(slug: string): Promise<{ categoria: Categoria; tramites: TarjetaTramite[] } | null> {
  if (USA_DATOS_DE_EJEMPLO) {
    const categoria = ejemplo.categorias.find((c) => c.slug === slug);
    if (!categoria) return null;
    const tramites = ejemplo.tramites
      .filter((t) => t.categoria === slug)
      .flatMap((t) => ejemplo.variantes.filter((v) => v.tramite === t.slug).map(tarjetaEjemplo));
    return { categoria, tramites };
  }

  const detalle = await pedirTema(slug);
  if (!detalle) return null;
  const contexto = await contextoDeApi();
  const categoria = contexto.categorias.get(detalle.tema.slug) ?? categoriaDesdeTema(detalle.tema);
  return { categoria, tramites: await tarjetasDesdeApi(detalle.tramites, {}, contexto, categoria) };
}

export async function masBuscados(limite = 6): Promise<TarjetaTramite[]> {
  if (USA_DATOS_DE_EJEMPLO) {
    return [...ejemplo.tramites]
      .filter((t) => t.popularidad !== undefined)
      .sort((a, b) => a.popularidad! - b.popularidad!)
      .slice(0, limite)
      .map((t) => ejemplo.variantes.find((v) => v.tramite === t.slug))
      .filter((v): v is Variante => !!v)
      .map(tarjetaEjemplo);
  }

  const datos = await pedirApi<TemasApi>('/v1/temas');
  const contexto = contextoDeTemas(datos);
  const slugs = [...datos.temas.map((tema) => tema.slug), ...datos.situaciones.map((tema) => tema.slug)];
  const detalles = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return await pedirTema(slug);
      } catch {
        return null;
      }
    }),
  );

  const porSlug = new Map<string, TarjetaApi>();
  for (const detalle of detalles) {
    if (!detalle) continue;
    for (const tramite of detalle.tramites) {
      if (!porSlug.has(tramite.slug)) porSlug.set(tramite.slug, tramite);
    }
  }

  const elegidos = [...porSlug.values()]
    .sort((a, b) => (a.popularidad ?? 1_000_000) - (b.popularidad ?? 1_000_000))
    .slice(0, limite);

  return tarjetasDesdeApi(elegidos, {}, contexto);
}

export async function listarProvincias(): Promise<Jurisdiccion[]> {
  if (USA_DATOS_DE_EJEMPLO) {
    return ejemplo.jurisdicciones
      .filter((j) => j.nivel === 'provincia')
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  const { jurisdicciones } = await pedirApi<{ jurisdicciones: JurisdiccionApi[] }>('/v1/jurisdicciones?nivel=provincia');
  return jurisdicciones.map(jurisdiccionDesdeApi).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function listarMunicipios(): Promise<Jurisdiccion[]> {
  if (USA_DATOS_DE_EJEMPLO) {
    return ejemplo.jurisdicciones
      .filter((j) => j.nivel === 'municipio')
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  const { jurisdicciones } = await pedirApi<{ jurisdicciones: JurisdiccionApi[] }>('/v1/jurisdicciones?nivel=municipio');
  return jurisdicciones.map(jurisdiccionDesdeApi).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function resolverUbicacion(prov?: string | null, muni?: string | null): Promise<Ubicacion | null> {
  if (USA_DATOS_DE_EJEMPLO) {
    const p = provinciaEjemplo(prov ?? undefined);
    if (prov && !p) return null;
    const m = municipioEjemplo(prov ?? undefined, muni ?? undefined);
    if (muni && !m) return null;
    return { provincia: p, municipio: m };
  }

  const [provincias, municipios] = await Promise.all([listarProvincias(), listarMunicipios()]);
  let provincia = prov ? provincias.find((j) => j.slug === prov) : undefined;
  if (prov && !provincia) return null;

  const municipio = muni
    ? municipios.find((j) => j.slug === muni && (!provincia || j.provincia === provincia.slug))
    : undefined;
  if (muni && !municipio) return null;

  if (!provincia && municipio?.provincia) {
    provincia = provincias.find((j) => j.slug === municipio.provincia);
  }

  return { provincia, municipio };
}

/**
 * Busca trámites por texto. Si hay ubicación, cada trámite apunta a la variante más cercana a ese
 * lugar. Con texto vacío y ubicación, devuelve todo lo que se puede hacer en ese lugar.
 */
export async function buscar(q: string, lugar: Ubicacion = {}): Promise<TarjetaTramite[]> {
  if (USA_DATOS_DE_EJEMPLO) {
    const palabras = normalizar(q).split(/\s+/).filter((p) => p && !PALABRAS_VACIAS.has(p));
    const prov = lugar.provincia?.slug;
    const muni = lugar.municipio?.slug;

    const puntaje = (t: Tramite) => {
      const vocabulario = normalizar([t.nombre, t.nombreBusqueda, ...t.sinonimos].join(' ')).split(/\s+/).filter(Boolean);
      return palabras.filter((p) => coincide(p, vocabulario)).length;
    };

    return ejemplo.tramites
      .map((t) => ({ t, p: palabras.length ? puntaje(t) : 1 }))
      .filter(({ p }) => p > 0)
      .sort((a, b) => b.p - a.p || (a.t.popularidad ?? 99) - (b.t.popularidad ?? 99))
      .flatMap(({ t }) => {
        if (prov) {
          const v = varianteMasCercanaEjemplo(t.slug, prov, muni);
          return v ? [tarjetaEjemplo(v)] : [];
        }
        return ejemplo.variantes.filter((v) => v.tramite === t.slug).map(tarjetaEjemplo);
      });
  }

  const prov = lugar.provincia?.slug;
  const muni = lugar.municipio?.slug;
  const contexto = await contextoDeApi();

  if (q.trim()) {
    try {
      const datos = await pedirApi<BusquedaApi>(conParametros('/v1/buscar', { q: q.trim(), prov, muni }));
      return tarjetasDesdeApi(datos.resultados, lugar, contexto);
    } catch (error) {
      if (esErrorApi(error, 'parametros_invalidos')) return [];
      throw error;
    }
  }

  if (!prov && !muni) return [];

  const datos = await pedirApi<TemasApi>('/v1/temas');
  const slugs = [...datos.temas.map((tema) => tema.slug), ...datos.situaciones.map((tema) => tema.slug)];
  const detalles = await Promise.all(slugs.map((slug) => pedirTema(slug, prov, muni)));
  const porSlug = new Map<string, TarjetaApi>();
  for (const detalle of detalles) {
    if (!detalle) continue;
    for (const tramite of detalle.tramites) {
      if (!porSlug.has(tramite.slug)) porSlug.set(tramite.slug, tramite);
    }
  }

  return tarjetasDesdeApi([...porSlug.values()], lugar, contexto);
}

/**
 * Ficha de un trámite en un lugar. Devuelve:
 * - `{ tipo: 'ficha' }` con la variante propia o la heredada del nivel de arriba;
 * - `{ tipo: 'indice' }` en la raíz de un trámite que no tiene versión nacional;
 * - `{ tipo: 'sin-datos' }` si el lugar existe pero no hay ninguna variante aplicable;
 * - `null` si el trámite o el lugar no existen (404).
 */
export async function obtenerFicha(
  tramiteSlug: string,
  provSlug?: string,
  muniSlug?: string,
): Promise<
  | { tipo: 'ficha'; ficha: Ficha }
  | { tipo: 'indice'; indice: IndiceTramite }
  | { tipo: 'sin-datos'; tramite: Tramite; categoria: Categoria; pedido: Ubicacion; alternativas: TarjetaTramite[] }
  | null
> {
  if (USA_DATOS_DE_EJEMPLO) {
    const tramite = ejemplo.tramites.find((t) => t.slug === tramiteSlug);
    if (!tramite) return null;
    const categoria = ejemplo.categorias.find((c) => c.slug === tramite.categoria)!;
    const pedido = await resolverUbicacion(provSlug, muniSlug);
    if (!pedido) return null;

    const variante = varianteMasCercanaEjemplo(tramite.slug, provSlug, muniSlug);
    const todas = ejemplo.variantes.filter((v) => v.tramite === tramite.slug);

    if (!variante) {
      if (!provSlug) return { tipo: 'indice', indice: { tramite, categoria, lugares: todas.map(tarjetaEjemplo) } };
      return { tipo: 'sin-datos', tramite, categoria, pedido, alternativas: todas.map(tarjetaEjemplo) };
    }

    const heredada = (variante.municipio ?? null) !== (muniSlug ?? null) || (variante.provincia ?? null) !== (provSlug ?? null);
    const organismo = ejemplo.organismos.find((o) => o.slug === variante.organismo)!;
    const oficinas = variante.oficinas.map((id) => ejemplo.oficinas.find((o) => o.id === id)!).filter(Boolean);
    const relacionados = tramite.relacionados
      .map((slug) => varianteMasCercanaEjemplo(slug, provSlug, muniSlug))
      .filter((v): v is Variante => !!v)
      .map(tarjetaEjemplo);

    return {
      tipo: 'ficha',
      ficha: {
        tramite,
        categoria,
        pedido,
        variante,
        heredada,
        lugarVariante: {
          provincia: provinciaEjemplo(variante.provincia),
          municipio: municipioEjemplo(variante.provincia, variante.municipio),
        },
        organismo,
        oficinas,
        relacionados,
        estado: estadoDe(variante.verificacion),
        indexable: !heredada,
        url: urlFicha(tramite.slug, provSlug, muniSlug),
        urlVariante: urlFicha(tramite.slug, variante.provincia, variante.municipio),
      },
    };
  }

  const pedido = await resolverUbicacion(provSlug, muniSlug);
  if (!pedido) return null;

  let datos: FichaApi | null = null;
  try {
    datos = await pedirFicha(tramiteSlug, provSlug, muniSlug);
  } catch (error) {
    if (esErrorApi(error, 'tramite_no_encontrado') || esErrorApi(error, 'ubicacion_no_encontrada')) return null;
    if (!esErrorApi(error, 'ficha_no_encontrada')) throw error;
  }

  const contexto = await contextoDeApi();
  if (datos) return { tipo: 'ficha', ficha: await fichaDesdeApi(datos, pedido, contexto) };

  const detalle = await pedirTramite(tramiteSlug);
  if (!detalle) return null;
  const categoria = categoriaDeTemas(detalle.temas, contexto);
  const tramite = tramiteDesdeApi(detalle.tramite, categoria);

  if (!provSlug && !muniSlug) {
    if (detalle.jurisdicciones.length === 0) return null;
    return {
      tipo: 'indice',
      indice: { tramite, categoria, lugares: await tarjetasDeJurisdicciones(detalle, contexto) },
    };
  }

  return {
    tipo: 'sin-datos',
    tramite,
    categoria,
    pedido,
    alternativas: await tarjetasDeJurisdicciones(detalle, contexto),
  };
}

export async function obtenerOrganismo(
  slug: string,
): Promise<{ organismo: Organismo; tramites: TarjetaTramite[]; oficinas: Oficina[]; lugar: string } | null> {
  if (USA_DATOS_DE_EJEMPLO) {
    const organismo = ejemplo.organismos.find((o) => o.slug === slug);
    if (!organismo) return null;
    return {
      organismo,
      tramites: ejemplo.variantes.filter((v) => v.organismo === slug).map(tarjetaEjemplo),
      oficinas: ejemplo.oficinas.filter((o) => o.organismo === slug),
      lugar: nombreLugarEjemplo(organismo.jurisdiccion),
    };
  }

  let datos: OrganismoDetalleApi;
  try {
    datos = await pedirApi<OrganismoDetalleApi>(`/v1/organismos/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (esErrorApi(error, 'organismo_no_encontrado')) return null;
    throw error;
  }

  const contexto = await contextoDeApi();
  return {
    organismo: organismoDesdeApi(datos.organismo, {}),
    tramites: await tarjetasDesdeApi(datos.tramites, {}, contexto),
    oficinas: datos.oficinas.map((oficina) => oficinaDesdeApi(oficina, datos.organismo.slug)),
    lugar: nombreLugar(datos.organismo.jurisdiccion),
  };
}

/** Variantes de un trámite con su URL, para avisar en la ficha si hay una para la ubicación guardada. */
export async function lugaresDeTramite(tramiteSlug: string): Promise<{ provincia?: string; municipio?: string; url: string }[]> {
  if (USA_DATOS_DE_EJEMPLO) {
    return ejemplo.variantes
      .filter((v) => v.tramite === tramiteSlug)
      .map((v) => ({ provincia: v.provincia, municipio: v.municipio, url: urlFicha(v.tramite, v.provincia, v.municipio) }));
  }

  const detalle = await pedirTramite(tramiteSlug);
  if (!detalle) return [];
  return detalle.jurisdicciones.map(({ jurisdiccion }) => {
    if (jurisdiccion.nivel === 'nacion') return { url: urlFicha(tramiteSlug) };
    if (jurisdiccion.nivel === 'provincia') {
      return { provincia: jurisdiccion.slug, url: urlFicha(tramiteSlug, jurisdiccion.slug) };
    }
    return {
      provincia: jurisdiccion.padre?.slug,
      municipio: jurisdiccion.slug,
      url: urlFicha(tramiteSlug, jurisdiccion.padre?.slug, jurisdiccion.slug),
    };
  });
}

function paginasDeTemas(indice: IndiceTemas): { url: string; modificada: string }[] {
  const hoy = hoyISO();
  return [
    { url: '/temas', modificada: hoy },
    ...indice.temas.flatMap((tema) => [
      { url: `/temas/${tema.slug}`, modificada: hoy },
      ...tema.subtemas.map((subtema) => ({ url: `/temas/${subtema.slug}`, modificada: hoy })),
    ]),
    ...indice.situaciones.map((situacion) => ({ url: `/situaciones/${situacion.slug}`, modificada: hoy })),
  ];
}

/** URLs indexables con su fecha de modificación real, para el sitemap. */
export async function urlsParaSitemap(): Promise<{ url: string; modificada: string }[]> {
  const indice = await listarTemas();

  if (USA_DATOS_DE_EJEMPLO) {
    const fichas = ejemplo.variantes.map((v) => ({
      url: urlFicha(v.tramite, v.provincia, v.municipio),
      modificada: v.verificacion.fecha,
    }));
    const indices = ejemplo.tramites
      .filter((t) => !ejemplo.variantes.some((v) => v.tramite === t.slug && !v.provincia))
      .map((t) => ({
        url: urlFicha(t.slug),
        modificada: ejemplo.variantes.filter((v) => v.tramite === t.slug).map((v) => v.verificacion.fecha).sort().at(-1) ?? hoyISO(),
      }));
    const organismos = ejemplo.organismos.map((o) => ({ url: `/organismos/${o.slug}`, modificada: hoyISO() }));
    return [
      { url: '/', modificada: hoyISO() },
      ...fichas,
      ...indices,
      ...paginasDeTemas(indice),
      ...organismos,
    ];
  }

  const datos = await pedirApi<SitemapApi>('/v1/sitemap');
  return [
    { url: '/', modificada: hoyISO() },
    ...datos.urls.map((entrada) => ({ url: entrada.url, modificada: fechaISO(entrada.actualizado_en) })),
    ...paginasDeTemas(indice),
  ];
}
