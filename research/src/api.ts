import type { BorradorFicha, EntradaCatalogo } from '@tramitando/shared';

export interface ResultadoCatalogo {
  nuevas: number;
  repetidas: number;
  invalidas: { indice: number; error: string }[];
}

/** Ítem de la cola de trabajo tal como lo devuelve `/ingest/v1/trabajo`. */
export interface ItemTrabajo {
  cola_trabajo_id: number | string;
  motivo?: string;
  catalogo?: {
    url?: string;
    nombre_oficial?: string;
    jurisdiccion_id?: string;
    organismo?: string | null;
    portal?: string;
  } | null;
  variante?: {
    id?: number;
    tramite_slug?: string;
    jurisdiccion_id?: string;
    contenido?: unknown;
    costos?: unknown;
    fuentes?: { url?: string }[];
  } | null;
  [clave: string]: unknown;
}

export interface OpcionesApi {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
}

function basePorDefecto(): string {
  return (process.env.TRAMITANDO_API ?? 'http://localhost:8787').replace(/\/+$/, '');
}

function tokenPorDefecto(): string | undefined {
  return process.env.INGEST_TOKEN;
}

export class ClienteApi {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(opciones: OpcionesApi = {}) {
    this.baseUrl = (opciones.baseUrl ?? basePorDefecto()).replace(/\/+$/, '');
    this.token = opciones.token ?? tokenPorDefecto();
    this.fetchFn = opciones.fetch ?? globalThis.fetch;
  }

  private async pedir<T>(ruta: string, init: RequestInit): Promise<T> {
    if (!this.token) throw new Error('Falta INGEST_TOKEN en el entorno');
    const res = await this.fetchFn(`${this.baseUrl}${ruta}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const texto = await res.text();
    let cuerpo: unknown = null;
    if (texto) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        cuerpo = texto;
      }
    }
    if (!res.ok) {
      const mensaje =
        cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo
          ? String((cuerpo as { error?: { mensaje?: unknown } }).error?.mensaje ?? res.statusText)
          : res.statusText;
      throw new Error(`La API respondió ${res.status}: ${mensaje}`);
    }
    return cuerpo as T;
  }

  async subirCatalogo(entradas: EntradaCatalogo[]): Promise<ResultadoCatalogo> {
    return this.pedir<ResultadoCatalogo>('/ingest/v1/catalogo', {
      method: 'POST',
      body: JSON.stringify({ entradas }),
    });
  }

  async pedirTrabajo(limite = 10): Promise<ItemTrabajo[]> {
    const cuerpo = await this.pedir<unknown>(`/ingest/v1/trabajo?limite=${limite}`, {
      method: 'GET',
    });
    let items: unknown[] = [];
    if (Array.isArray(cuerpo)) {
      items = cuerpo;
    } else if (cuerpo && typeof cuerpo === 'object') {
      const objeto = cuerpo as Record<string, unknown>;
      for (const clave of ['items', 'trabajo', 'resultados'] as const) {
        const valor = objeto[clave];
        if (Array.isArray(valor)) {
          items = valor;
          break;
        }
      }
    }
    return items.map((item) => item as ItemTrabajo);
  }

  async subirBorrador(borrador: BorradorFicha, colaTrabajoId: number | string): Promise<unknown> {
    return this.pedir<unknown>('/ingest/v1/borradores', {
      method: 'POST',
      body: JSON.stringify({ borrador, cola_trabajo_id: colaTrabajoId }),
    });
  }

  /** Aprueba un borrador (en local, con ADMIN_DEV=1 la ruta de admin no pide login). Publica la ficha. */
  async aprobarBorrador(id: number | string): Promise<unknown> {
    return this.pedir<unknown>(`/admin/v1/borradores/${id}/aprobar`, { method: 'POST', body: '{}' });
  }

  /** Saca del catálogo algo que no es un trámite (una noticia): no vuelve a la cola y, si estaba publicado, se archiva. */
  async descartar(id: { colaTrabajoId: number | string } | { catalogoId: number }): Promise<unknown> {
    const cuerpo = 'colaTrabajoId' in id ? { cola_trabajo_id: id.colaTrabajoId } : { catalogo_id: id.catalogoId };
    return this.pedir<unknown>('/ingest/v1/descartar', { method: 'POST', body: JSON.stringify(cuerpo) });
  }

  async sinCambios(
    colaTrabajoId: number | string,
    varianteId: number,
    notas?: string,
  ): Promise<unknown> {
    return this.pedir<unknown>('/ingest/v1/sin-cambios', {
      method: 'POST',
      body: JSON.stringify({ cola_trabajo_id: colaTrabajoId, variante_id: varianteId, notas: notas ?? null }),
    });
  }
}
