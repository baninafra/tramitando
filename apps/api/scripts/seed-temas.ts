/**
 * Carga la taxonomía inicial de `research/data/temas.json` en la API local.
 *
 * Uso:
 *   npm run seed:temas -w @tramitando/api
 *
 * La API tiene que estar corriendo (`npm run dev -w @tramitando/api`) y el admin en modo local
 * (`ADMIN_DEV=1` en `apps/api/.dev.vars`). Si el archivo todavía no existe, avisa y termina bien.
 */
import { readFile } from 'node:fs/promises';

const API = process.env.API_URL ?? 'http://localhost:8787';
const RUTA_TEMAS = new URL('../../../research/data/temas.json', import.meta.url);

interface TemaEntrada {
  slug?: unknown;
  nombre?: unknown;
  descripcion?: unknown;
  tipo?: unknown;
  padre?: unknown;
  icono?: unknown;
  orden?: unknown;
  en_portada?: unknown;
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
  const respuesta = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
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

function texto(valor: unknown, respaldo = ''): string {
  return typeof valor === 'string' ? valor.trim() : respaldo;
}

function slugDePadre(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (valor && typeof valor === 'object' && 'slug' in valor) {
    const slug = (valor as { slug?: unknown }).slug;
    if (typeof slug === 'string' && slug.trim()) return slug.trim();
  }
  return null;
}

async function main() {
  let crudo: string;
  try {
    crudo = await readFile(RUTA_TEMAS, 'utf8');
  } catch (error) {
    const codigo = (error as NodeJS.ErrnoException).code;
    if (codigo === 'ENOENT') {
      console.log('No existe research/data/temas.json todavía. No hay temas para cargar.');
      return;
    }
    throw error;
  }

  const datos: unknown = JSON.parse(crudo);
  const lista = Array.isArray(datos)
    ? datos
    : datos && typeof datos === 'object' && Array.isArray((datos as { temas?: unknown }).temas)
      ? (datos as { temas: unknown[] }).temas
      : null;

  if (!lista) {
    console.error('research/data/temas.json tiene que ser una lista o un objeto con "temas".');
    process.exitCode = 1;
    return;
  }

  // temas.json (research/prompts/temas.md) viene anidado: cada tema trae `subtemas` y las situaciones
  // van aparte. Se aplana a una lista con `padre` y `tipo`. Los 8 primeros temas van a la portada.
  const situaciones =
    !Array.isArray(datos) && Array.isArray((datos as { situaciones?: unknown }).situaciones)
      ? ((datos as { situaciones: TemaEntrada[] }).situaciones)
      : [];
  const plana: TemaEntrada[] = [];
  (lista as TemaEntrada[]).forEach((tema, i) => {
    plana.push({ ...tema, en_portada: tema.en_portada ?? i < 8 });
    const subtemas = (tema as { subtemas?: unknown }).subtemas;
    if (Array.isArray(subtemas)) {
      for (const sub of subtemas as TemaEntrada[]) plana.push({ ...sub, padre: tema.slug, tipo: 'tema' });
    }
  });
  for (const s of situaciones) plana.push({ ...s, tipo: 'situacion', padre: null });

  const pendientes = plana
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => texto(item.slug) && texto(item.nombre));

  const creados = new Set<string>();
  let cantidad = 0;

  while (pendientes.length > 0) {
    let progreso = false;
    for (let i = 0; i < pendientes.length; ) {
      const { item, indice } = pendientes[i]!;
      const slug = texto(item.slug);
      const padre = slugDePadre(item.padre);
      const padreEnLista = padre !== null && pendientes.some((p) => texto(p.item.slug) === padre);
      if (padre !== null && padreEnLista && !creados.has(padre)) {
        i += 1;
        continue;
      }

      const cuerpo = {
        slug,
        nombre: texto(item.nombre),
        descripcion: texto(item.descripcion).slice(0, 200),
        tipo: item.tipo === 'situacion' ? 'situacion' : 'tema',
        padre,
      };

      try {
        await pedir('/admin/v1/temas', { method: 'POST', body: JSON.stringify(cuerpo) });
      } catch (error) {
        if (!(error instanceof ErrorHttp) || error.status !== 409) throw error;
      }

      await pedir(`/admin/v1/temas/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          descripcion: cuerpo.descripcion,
          icono: typeof item.icono === 'string' ? item.icono : null,
          orden: typeof item.orden === 'number' && Number.isInteger(item.orden) ? item.orden : indice + 1,
          en_portada: item.en_portada === true,
          estado: 'activo',
        }),
      });

      creados.add(slug);
      pendientes.splice(i, 1);
      progreso = true;
      cantidad += 1;
      console.log(`Tema ${slug} listo.`);
    }

    if (!progreso) {
      for (const { item } of pendientes) console.warn(`No pudimos ubicar el tema padre de "${texto(item.slug)}".`);
      break;
    }
  }

  console.log(`Taxonomía cargada: ${cantidad} temas.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
