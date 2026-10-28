/**
 * Cliente de la API de Tramitando.
 *
 * En producción usa el service binding `API` (lo configura `middleware.ts` con el `env` del
 * Worker). En desarrollo, si no hay binding, llama a `API_URL` o a la API local en el puerto 8787.
 */

interface BindingApi {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

let binding: BindingApi | undefined;

/** Registra el binding del Worker. La web solo llama a esto desde el middleware. */
export function configurarApi(entorno: { API?: BindingApi }): void {
  binding = entorno.API;
}

export class ErrorApi extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.codigo = codigo;
  }
}

export function esErrorApi(error: unknown, codigo?: string): error is ErrorApi {
  return error instanceof ErrorApi && (codigo === undefined || error.codigo === codigo);
}

export interface OpcionesPedido extends Omit<RequestInit, 'body'> {
  body?: BodyInit | null;
}

/** Hace un pedido a la API y devuelve el JSON. Lanza `ErrorApi` con el mensaje en español. */
export async function pedirApi<T>(ruta: string, opciones: OpcionesPedido = {}): Promise<T> {
  const headers = new Headers(opciones.headers);
  headers.set('accept', 'application/json');
  if (opciones.body && !(opciones.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const base = import.meta.env.API_URL ?? 'http://localhost:8787';
  const usarBinding = binding !== undefined && !import.meta.env.DEV;
  const url = usarBinding ? new Request(`https://api.interno${ruta}`, { ...opciones, headers }) : `${base}${ruta}`;

  let respuesta: Response;
  try {
    respuesta = usarBinding && binding ? await binding.fetch(url) : await fetch(url, { ...opciones, headers });
  } catch {
    throw new ErrorApi(503, 'api_no_disponible', 'No pudimos conectarnos con la API. Probá de nuevo en un rato.');
  }

  const texto = await respuesta.text();
  let datos: unknown;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    const error = (datos as { error?: { codigo?: unknown; mensaje?: unknown } } | null)?.error;
    throw new ErrorApi(
      respuesta.status,
      typeof error?.codigo === 'string' ? error.codigo : 'error_api',
      typeof error?.mensaje === 'string' ? error.mensaje : 'La API devolvió un error.',
    );
  }

  return datos as T;
}

/** Arma la query string omitiendo los valores vacíos. */
export function conParametros(ruta: string, parametros: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null && valor !== '') query.set(clave, String(valor));
  }
  const texto = query.toString();
  return texto ? `${ruta}?${texto}` : ruta;
}

// ---------------------------------------------------------------------------------------------
// Tipos de las respuestas de la API
// ---------------------------------------------------------------------------------------------

export type NivelApi = 'nacion' | 'provincia' | 'municipio';

export type BloqueApi = 'resumen' | 'costo' | 'plazo' | 'quien' | 'requisitos' | 'pasos' | 'donde' | 'consejos';

export interface JurisdiccionApi {
  id: string;
  nivel: NivelApi;
  nombre: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  padre: { id: string; nivel: NivelApi; nombre: string; slug: string } | null;
}

export interface TemaApi {
  id: number;
  slug: string;
  nombre: string;
  descripcion: string;
  icono: string | null;
  orden: number;
  en_portada: boolean;
  cantidad_tramites: number;
}

export interface TemaConSubtemasApi extends TemaApi {
  subtemas: TemaApi[];
}

export interface TemasApi {
  temas: TemaConSubtemasApi[];
  situaciones: TemaApi[];
}

export interface TemaDetalleApi {
  tema: TemaApi & { tipo: 'tema' | 'situacion'; padre: { slug: string; nombre: string } | null };
  subtemas: TemaApi[];
  tramites: TarjetaApi[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
}

export interface TramiteApi {
  id: number;
  slug: string;
  nombre: string;
  nombre_busqueda: string;
  resumen: string;
  sinonimos: string[];
  popularidad: number | null;
  creado_en: string;
}

export interface TarjetaApi {
  id: number;
  slug: string;
  nombre: string;
  nombre_busqueda: string;
  resumen: string;
  sinonimos: string[];
  popularidad: number | null;
  variante: {
    id: number;
    jurisdiccion: { id: string; nivel: NivelApi; nombre: string; slug: string };
    organismo: { id: number; slug: string; nombre: string; sigla: string | null } | null;
    verificacion: 'verificado' | 'revisar';
    actualizado_en: string;
  } | null;
}

export interface TemaDeTramiteApi {
  id: number;
  slug: string;
  nombre: string;
  principal: boolean;
}

export interface FuenteApi {
  id: number;
  url: string;
  titulo: string | null;
  consultada_en: string | null;
}

export interface CostoApi {
  modalidad: string;
  gratis: boolean;
  monto_centavos: number | null;
  monto_texto: string;
  vigente_desde: string | null;
  nota: string | null;
  fuente_url: string | null;
}

export interface OficinaApi {
  id: number;
  nombre: string;
  direccion: string;
  localidad: string;
  horario: string | null;
  lat: number | null;
  lng: number | null;
  fuente_url: string | null;
}

export interface ContenidoApi {
  quien_puede: string[];
  requisitos: { texto: string; aclaracion: string | null }[];
  pasos_online: { texto: string }[];
  pasos_presencial: { texto: string }[];
  requiere_turno: boolean | null;
  turno_url: string | null;
  plazo: string | null;
  consejos: string[];
}

export interface OrganismoApi {
  id: number;
  slug: string;
  nombre: string;
  sigla: string | null;
  descripcion: string;
  web: string | null;
  jurisdiccion: { id: string; nivel: NivelApi; nombre: string; slug: string; padre?: { id: string; nivel: NivelApi; nombre: string; slug: string } | null };
}

export interface VarianteApi {
  id: number;
  jurisdiccion: { id: string; nivel: NivelApi; nombre: string; slug: string };
  organismo: OrganismoApi | null;
  contenido: ContenidoApi | null;
  costos: CostoApi[];
  fuentes: Record<string, FuenteApi[]>;
  oficinas: OficinaApi[];
  verificacion: 'verificado' | 'revisar';
  verificado_en: string | null;
  proxima_revision: string | null;
  actualizado_en: string;
  version: number | null;
}

export interface FichaApi {
  tramite: TramiteApi;
  temas: TemaDeTramiteApi[];
  variante: VarianteApi;
  heredada_de: NivelApi | null;
  indexable: boolean;
}

export interface TramiteDetalleApi {
  tramite: TramiteApi;
  temas: TemaDeTramiteApi[];
  jurisdicciones: {
    variante_id: number;
    verificacion: 'verificado' | 'revisar';
    verificado_en: string;
    proxima_revision: string;
    actualizado_en: string;
    jurisdiccion: JurisdiccionApi;
    organismo: { id: number; slug: string; nombre: string; sigla: string | null } | null;
  }[];
}

export interface OrganismoDetalleApi {
  organismo: OrganismoApi;
  tramites: TarjetaApi[];
  oficinas: (OficinaApi & { jurisdiccion: { id: string; nombre: string; slug: string } })[];
}

export interface SitemapApi {
  urls: { url: string; actualizado_en: string; tipo: 'ficha' | 'tramite' }[];
}

export interface BusquedaApi {
  resultados: TarjetaApi[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
}
