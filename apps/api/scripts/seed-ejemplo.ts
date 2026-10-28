/**
 * Carga los datos de ejemplo de la web en la API local, pasando por el flujo real de ingesta y
 * aprobación: temas → catálogo → cola de trabajo → borrador → aprobación del admin.
 *
 * Uso:
 *   npm run seed:ejemplo -w @tramitando/api
 *
 * Requiere la API local (`npm run dev -w @tramitando/api`), las migraciones aplicadas y
 * `apps/api/.dev.vars` con `ADMIN_DEV=1`, `INGEST_TOKEN` e `IP_SALT`.
 */
import { readFile } from 'node:fs/promises';
import { esUrlOficial, type BorradorFicha } from '@tramitando/shared';
import { oficinas, organismos, tramites, variantes } from '../../web/src/lib/datos-ejemplo';
import type { Variante } from '../../web/src/lib/data';

const API = process.env.API_URL ?? 'http://localhost:8787';
const INGEST_TOKEN = process.env.INGEST_TOKEN ?? 'dev-ingest-token';
const RUTA_TEMAS = new URL('../../../research/data/temas.json', import.meta.url);

/**
 * Cada trámite de ejemplo se publica en el subtema real de `research/data/temas.json`. No se crean
 * temas propios: la taxonomía se carga antes con `npm run seed:temas`.
 */
const TEMA_DE_TRAMITE: Record<string, string> = {
  'renovacion-de-dni': 'dni',
  'licencia-de-conducir': 'licencia-de-conducir',
  'partida-de-nacimiento': 'partidas-y-actas',
  'constancia-de-cuil': 'cuil-y-clave-de-seguridad-social',
};

interface TemaArchivo {
  slug?: unknown;
  subtemas?: { slug?: unknown }[];
}

async function cargarSubtemas(): Promise<Set<string>> {
  let crudo: string;
  try {
    crudo = await readFile(RUTA_TEMAS, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('No existe research/data/temas.json. Cargá la taxonomía con npm run seed:temas -w @tramitando/api.');
    }
    throw error;
  }

  const datos: unknown = JSON.parse(crudo);
  const lista = Array.isArray(datos)
    ? datos
    : datos && typeof datos === 'object' && Array.isArray((datos as { temas?: unknown }).temas)
      ? (datos as { temas: unknown[] }).temas
      : null;
  if (!lista) throw new Error('research/data/temas.json tiene que ser una lista o un objeto con "temas".');

  const subtemas = new Set<string>();
  for (const tema of lista as TemaArchivo[]) {
    for (const subtema of tema.subtemas ?? []) {
      if (typeof subtema.slug === 'string' && subtema.slug.trim()) subtemas.add(subtema.slug.trim());
    }
  }
  return subtemas;
}

function temaDeTramite(tramite: string, subtemas: Set<string>): string {
  const tema = TEMA_DE_TRAMITE[tramite];
  if (!tema) throw new Error(`No hay un subtema asignado para el trámite de ejemplo "${tramite}".`);
  if (!subtemas.has(tema)) {
    throw new Error(`El subtema "${tema}" del trámite "${tramite}" no existe en research/data/temas.json.`);
  }
  return tema;
}

interface JurisdiccionPublica {
  id: string;
  nivel: 'nacion' | 'provincia' | 'municipio';
  nombre: string;
  slug: string;
  padre: { id: string; slug: string; nombre: string } | null;
}

interface ItemTrabajo {
  cola_trabajo_id: number;
  catalogo: { url: string } | null;
}

class ErrorHttp extends Error {
  constructor(
    public readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`${API}${ruta}`, init);
  const texto = await respuesta.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  if (!respuesta.ok) {
    const mensaje = (datos as { error?: { mensaje?: string } } | null)?.error?.mensaje ?? texto;
    throw new ErrorHttp(respuesta.status, `${respuesta.status} ${ruta}: ${mensaje}`);
  }
  return datos as T;
}

function headersIngesta(): HeadersInit {
  return { authorization: `Bearer ${INGEST_TOKEN}`, 'content-type': 'application/json' };
}

function headersAdmin(): HeadersInit {
  return { 'content-type': 'application/json' };
}

function fechaHora(fecha: string): string {
  return new Date(`${fecha}T12:00:00.000Z`).toISOString();
}

function bloquesApi(bloques: string[]): BorradorFicha['fuentes'][number]['bloques'] {
  return bloques.map((bloque) => (bloque === 'oficinas' ? 'donde' : bloque)) as BorradorFicha['fuentes'][number]['bloques'];
}

function mapaJurisdicciones(todas: JurisdiccionPublica[]) {
  const nacion = todas.find((j) => j.nivel === 'nacion');
  const provincias = new Map(todas.filter((j) => j.nivel === 'provincia').map((j) => [j.slug, j]));
  const municipios = new Map(
    todas
      .filter((j) => j.nivel === 'municipio')
      .map((j) => [`${j.padre?.slug ?? ''}/${j.slug}`, j]),
  );
  return { nacion, provincias, municipios };
}

function idDeVariante(
  variante: Variante,
  mapa: ReturnType<typeof mapaJurisdicciones>,
): string {
  if (!variante.provincia) {
    if (!mapa.nacion) throw new Error('La API no tiene la jurisdicción Nación.');
    return mapa.nacion.id;
  }

  const provincia = mapa.provincias.get(variante.provincia);
  if (!provincia) throw new Error(`No existe la provincia "${variante.provincia}" en la API.`);
  if (!variante.municipio) return provincia.id;

  const municipio = mapa.municipios.get(`${variante.provincia}/${variante.municipio}`);
  if (!municipio) throw new Error(`No existe el municipio "${variante.municipio}" de ${variante.provincia}.`);
  return municipio.id;
}

function rutaFicha(variante: Variante): string {
  const query = new URLSearchParams();
  if (variante.provincia) query.set('prov', variante.provincia);
  if (variante.municipio) query.set('muni', variante.municipio);
  const texto = query.toString();
  return `/v1/fichas/${encodeURIComponent(variante.tramite)}${texto ? `?${texto}` : ''}`;
}

async function yaPublicada(variante: Variante): Promise<boolean> {
  try {
    await pedir(rutaFicha(variante));
    return true;
  } catch (error) {
    if (error instanceof ErrorHttp && error.status === 404) return false;
    throw error;
  }
}

function urlFuente(variante: Variante, id: string): string {
  const fuente = variante.fuentes.find((f) => f.id === id);
  if (!fuente) throw new Error(`La variante ${variante.id} no tiene la fuente ${id}.`);
  return fuente.url;
}

function borradorDe(variante: Variante, jurisdiccionId: string, subtemas: Set<string>): BorradorFicha {
  const tramite = tramites.find((t) => t.slug === variante.tramite);
  if (!tramite) throw new Error(`No existe el trámite de ejemplo ${variante.tramite}.`);
  const organismo = organismos.find((o) => o.slug === variante.organismo);
  if (!organismo) throw new Error(`No existe el organismo de ejemplo ${variante.organismo}.`);

  const enlaceTurno =
    variante.pasos.online?.flatMap((paso) => (paso.enlace ? [paso.enlace.url] : [])).find(esUrlOficial) ?? null;

  const fuentes: BorradorFicha['fuentes'] = variante.fuentes.map((fuente) => ({
    url: fuente.url,
    titulo: fuente.titulo,
    bloques: bloquesApi(fuente.respalda),
    consultada_en: fechaHora(fuente.verificadaEl),
  }));

  return {
    tramite: {
      slug: tramite.slug,
      nombre: tramite.nombre,
      nombre_busqueda: tramite.nombreBusqueda,
      resumen: tramite.resumen,
      sinonimos: tramite.sinonimos,
      temas: [temaDeTramite(tramite.slug, subtemas)],
      temas_propuestos: [],
    },
    jurisdiccion_id: jurisdiccionId,
    organismo: {
      nombre: organismo.nombre,
      sigla: organismo.sigla ?? null,
      web: organismo.web,
    },
    contenido: {
      quien_puede: variante.quienPuede,
      requisitos: variante.requisitos.map((requisito) => ({
        texto: requisito.texto,
        aclaracion: requisito.aclaracion ?? null,
      })),
      pasos_online: (variante.pasos.online ?? []).map((paso) => ({ texto: paso.texto })),
      pasos_presencial: (variante.pasos.presencial ?? []).map((paso) => ({ texto: paso.texto })),
      requiere_turno: Boolean(variante.pasos.turno),
      turno_url: enlaceTurno,
      plazo: variante.plazo.resolucion,
      consejos: variante.consejos,
    },
    costos: variante.costos.map((costo) => ({
      modalidad: costo.concepto,
      gratis: costo.monto === 0,
      monto_centavos: costo.monto === 0 ? null : Math.round(costo.monto * 100),
      vigente_desde: costo.vigenteDesde,
      nota: null,
      fuente_url: urlFuente(variante, costo.fuente),
    })),
    oficinas: variante.oficinas.flatMap((id) => {
      const oficina = oficinas.find((o) => o.id === id);
      if (!oficina) return [];
      return [
        {
          nombre: oficina.nombre,
          direccion: oficina.direccion,
          localidad: oficina.localidad,
          horario: oficina.horario,
          fuente_url: urlFuente(variante, oficina.fuente),
        },
      ];
    }),
    fuentes,
    sin_confirmar: [],
  };
}

function urlCatalogo(variante: Variante): string {
  const fuente = variante.fuentes[0];
  if (!fuente) throw new Error(`La variante ${variante.id} no tiene fuentes.`);
  const url = new URL(fuente.url);
  url.searchParams.set('tramitando-ejemplo', variante.id);
  return url.toString();
}

async function sembrarVariante(
  variante: Variante,
  mapa: ReturnType<typeof mapaJurisdicciones>,
  subtemas: Set<string>,
): Promise<boolean> {
  if (await yaPublicada(variante)) {
    console.log(`Ya está publicada: ${variante.tramite} (${variante.id}).`);
    return true;
  }

  const tramite = tramites.find((t) => t.slug === variante.tramite);
  if (!tramite) throw new Error(`No existe el trámite de ejemplo ${variante.tramite}.`);
  const organismo = organismos.find((o) => o.slug === variante.organismo);
  if (!organismo) throw new Error(`No existe el organismo de ejemplo ${variante.organismo}.`);

  const jurisdiccionId = idDeVariante(variante, mapa);
  const url = urlCatalogo(variante);

  const catalogo = await pedir<{ nuevas: number; repetidas: number; invalidas: { indice: number; error: string }[] }>(
    '/ingest/v1/catalogo',
    {
      method: 'POST',
      headers: headersIngesta(),
      body: JSON.stringify({
        entradas: [
          {
            url,
            nombre_oficial: `${tramite.nombre} · ${variante.provincia ?? 'Nación'}`.slice(0, 300),
            jurisdiccion_id: jurisdiccionId,
            organismo: organismo.nombre,
            temas_sugeridos: [temaDeTramite(tramite.slug, subtemas)],
            portal: 'seed-ejemplo',
          },
        ],
      }),
    },
  );

  if (catalogo.invalidas.length > 0) {
    throw new Error(`El catálogo rechazó la entrada: ${catalogo.invalidas[0]?.error ?? 'error desconocido'}`);
  }

  const trabajo = await pedir<ItemTrabajo[]>('/ingest/v1/trabajo?limite=50', { headers: headersIngesta() });
  const item = trabajo.find((t) => t.catalogo?.url === url);
  if (!item) {
    console.warn(`No hay ítem de cola para ${url}. ¿Quedó un borrador pendiente de una corrida anterior?`);
    return false;
  }

  const borrador = borradorDe(variante, jurisdiccionId, subtemas);
  const creado = await pedir<{ id: number; chequeos: string[] }>('/ingest/v1/borradores', {
    method: 'POST',
    headers: headersIngesta(),
    body: JSON.stringify({ cola_trabajo_id: item.cola_trabajo_id, borrador }),
  });

  if (creado.chequeos.length > 0) {
    console.warn(`Chequeos de ${variante.id}: ${creado.chequeos.join('; ')}`);
  }

  await pedir(`/admin/v1/borradores/${creado.id}/aprobar`, {
    method: 'POST',
    headers: headersAdmin(),
    body: '{}',
  });

  console.log(`Publicada: ${variante.tramite} (${variante.id}).`);
  return true;
}

async function main() {
  console.log(`Sembrando datos de ejemplo en ${API}...`);
  const subtemas = await cargarSubtemas();
  for (const tramite of tramites) temaDeTramite(tramite.slug, subtemas);

  const { jurisdicciones } = await pedir<{ jurisdicciones: JurisdiccionPublica[] }>('/v1/jurisdicciones');
  const mapa = mapaJurisdicciones(jurisdicciones);

  let fallas = 0;
  for (const variante of variantes) {
    try {
      if (!(await sembrarVariante(variante, mapa, subtemas))) fallas += 1;
    } catch (error) {
      fallas += 1;
      console.error(error instanceof Error ? error.message : error);
    }
  }

  if (fallas > 0) {
    console.error(`Terminó con ${fallas} variante(s) sin publicar.`);
    process.exitCode = 1;
  } else {
    console.log('Datos de ejemplo cargados.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
