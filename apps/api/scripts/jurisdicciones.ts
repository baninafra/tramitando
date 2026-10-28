/**
 * Carga inicial de jurisdicciones desde la API oficial Georef.
 *
 * Uso (desde apps/api):
 *   npx tsx scripts/jurisdicciones.ts
 *
 * Genera `migrations/0002_jurisdicciones.sql` con INSERT OR IGNORE. El archivo es estable: mismos
 * datos de Georef, mismo orden y mismo contenido.
 *
 * CABA no tiene municipios: sus 15 comunas salen de `/departamentos` y se cargan como municipios.
 * La API de municipios hoy también devuelve esas comunas; se descartan para no duplicarlas.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Centroide {
  lat: number;
  lon: number;
}

interface ProvinciaGeoref {
  id: string;
  nombre: string;
  centroide?: Centroide | null;
}

interface MunicipioGeoref {
  id: string;
  nombre: string;
  centroide?: Centroide | null;
  provincia: { id: string };
}

interface DepartamentoGeoref {
  id: string;
  nombre: string;
  centroide?: Centroide | null;
  provincia: { id: string };
}

interface RespuestaGeoref<T> {
  cantidad: number;
  provincias?: T[];
  municipios?: T[];
  departamentos?: T[];
}

type Fila = {
  id: string;
  nivel: 'nacion' | 'provincia' | 'municipio';
  nombre: string;
  slug: string;
  padre: string | null;
  georefId: string | null;
  lat: number | null;
  lng: number | null;
};

const BASE = 'https://apis.datos.gob.ar/georef/api';
const CABA = '02';
const POR_LOTE = 100;

function url(camino: string, campos: string, max: number): string {
  return `${BASE}/${camino}?campos=${campos}&max=${max}`;
}

async function bajar<T>(
  destino: string,
  clave: 'provincias' | 'municipios' | 'departamentos',
): Promise<T[]> {
  const respuesta = await fetch(destino);
  if (!respuesta.ok) throw new Error(`Georef respondió ${respuesta.status} en ${destino}`);
  const datos = (await respuesta.json()) as RespuestaGeoref<T>;
  return datos[clave] ?? [];
}

/** Minúsculas, sin tildes, con guiones: "Tierra del Fuego, Antártida..." → "tierra-del-fuego-antartida". */
export function slugificar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function coordenadas(centroide: Centroide | null | undefined): { lat: number | null; lng: number | null } {
  if (!centroide) return { lat: null, lng: null };
  return { lat: centroide.lat, lng: centroide.lon };
}

function sqlTexto(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

function sqlNumero(valor: number | null): string {
  return valor === null ? 'NULL' : String(valor);
}

function filaSql(fila: Fila): string {
  return `(${[
    sqlTexto(fila.id),
    sqlTexto(fila.nivel),
    sqlTexto(fila.nombre),
    sqlTexto(fila.slug),
    fila.padre === null ? 'NULL' : sqlTexto(fila.padre),
    fila.georefId === null ? 'NULL' : sqlTexto(fila.georefId),
    sqlNumero(fila.lat),
    sqlNumero(fila.lng),
  ].join(', ')})`;
}

function asignarSlugs(filas: Fila[]): Fila[] {
  const usados = new Set<string>();
  for (const fila of filas) {
    const base = slugificar(fila.nombre);
    const clave = (slug: string) => `${fila.padre ?? ''}::${slug}`;
    let slug = base;
    if (usados.has(clave(slug))) slug = `${base}-${fila.georefId ?? fila.id}`;
    let intento = 2;
    while (usados.has(clave(slug))) slug = `${base}-${fila.georefId ?? fila.id}-${intento++}`;
    usados.add(clave(slug));
    fila.slug = slug;
  }
  return filas;
}

function porId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, 'en', { numeric: false });
}

async function main(): Promise<void> {
  const [provincias, municipios, departamentos] = await Promise.all([
    bajar<ProvinciaGeoref>(url('provincias', 'id,nombre,centroide', 100), 'provincias'),
    bajar<MunicipioGeoref>(url('municipios', 'id,nombre,centroide,provincia.id', 5000), 'municipios'),
    bajar<DepartamentoGeoref>(url('departamentos', 'id,nombre,centroide,provincia.id', 1000), 'departamentos'),
  ]);

  if (provincias.length === 0) throw new Error('Georef no devolvió provincias');

  const nacion: Fila = {
    id: 'nacion',
    nivel: 'nacion',
    nombre: 'Argentina',
    slug: 'argentina',
    padre: null,
    georefId: null,
    lat: null,
    lng: null,
  };

  const filasProvincias: Fila[] = provincias
    .slice()
    .sort(porId)
    .map((provincia) => {
      const { lat, lng } = coordenadas(provincia.centroide);
      return {
        id: `prov-${provincia.id}`,
        nivel: 'provincia',
        nombre: provincia.nombre,
        slug: '',
        padre: 'nacion',
        georefId: provincia.id,
        lat,
        lng,
      };
    });
  asignarSlugs(filasProvincias);

  // CABA: sus comunas vienen como departamentos y se publican como municipios.
  const comunasCaba: Fila[] = departamentos
    .filter((departamento) => departamento.provincia.id === CABA)
    .sort(porId)
    .map((departamento) => {
      const { lat, lng } = coordenadas(departamento.centroide);
      return {
        id: `muni-${departamento.id}`,
        nivel: 'municipio',
        nombre: departamento.nombre,
        slug: '',
        padre: `prov-${CABA}`,
        georefId: departamento.id,
        lat,
        lng,
      };
    });

  const filasMunicipios: Fila[] = municipios
    .filter((municipio) => municipio.provincia.id !== CABA)
    .sort(porId)
    .map((municipio) => {
      const { lat, lng } = coordenadas(municipio.centroide);
      return {
        id: `muni-${municipio.id}`,
        nivel: 'municipio',
        nombre: municipio.nombre,
        slug: '',
        padre: `prov-${municipio.provincia.id}`,
        georefId: municipio.id,
        lat,
        lng,
      };
    })
    .concat(comunasCaba)
    .sort(porId);
  asignarSlugs(filasMunicipios);

  const filas = [nacion, ...filasProvincias, ...filasMunicipios];

  const partes: string[] = [
    '-- Tramitando · jurisdicciones (generado por scripts/jurisdicciones.ts, no editar a mano).',
    '-- Fuente: API Georef (https://apis.datos.gob.ar/georef/api).',
    '-- Nación, 24 provincias y municipios. Las 15 comunas de CABA se cargan como municipios.',
    '',
    'PRAGMA foreign_keys = ON;',
    '',
  ];

  for (let i = 0; i < filas.length; i += POR_LOTE) {
    const lote = filas.slice(i, i + POR_LOTE);
    partes.push('INSERT OR IGNORE INTO jurisdicciones (id, nivel, nombre, slug, padre_id, georef_id, lat, lng) VALUES');
    partes.push(lote.map(filaSql).join(',\n') + ';');
    partes.push('');
  }

  const destino = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0002_jurisdicciones.sql');
  await writeFile(destino, partes.join('\n'), 'utf8');

  const provinciasCargadas = filasProvincias.length;
  const municipiosCargados = filasMunicipios.length;
  console.log(`Escrito ${destino}`);
  console.log(`Provincias: ${provinciasCargadas} · municipios: ${municipiosCargados} · total: ${filas.length}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
