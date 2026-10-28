/**
 * Foto del lugar de una ficha (municipio, provincia o Nación) desde la Wikipedia en español: la imagen
 * principal del artículo, que es de Wikimedia Commons con licencia libre. Siempre se muestra con el
 * crédito y el link al archivo. Si no hay foto o Wikipedia no responde, la ficha se ve igual sin ella.
 */

import fotosGuardadas from '../data/fotos-lugares.json';

export interface FotoLugar {
  url: string;
  /** Página del archivo en Commons (autor y licencia). */
  credito: string;
  alt: string;
}

interface Lugar {
  provincia?: { nombre: string };
  municipio?: { nombre: string };
}

// Wikimedia solo sirve miniaturas en anchos estándar (1280 sí, 1200 no).
const ANCHO = 1280;
const cache = new Map<string, Promise<FotoLugar | null>>();

/** Pasa la URL de Commons a una miniatura de ANCHO px: las originales pesan varios MB. */
export function miniatura(url: string): string {
  const u = (url.split('?')[0] as string).replace('//thumb.wikimedia.org/', '//upload.wikimedia.org/');
  const enThumb = /\/commons\/thumb\/(.+)\/\d+px-[^/]+$/.exec(u);
  if (enThumb) return u.replace(/\/\d+px-([^/]+)$/, `/${ANCHO}px-$1`);
  const original = /\/commons\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+))$/.exec(u);
  if (original) return `https://upload.wikimedia.org/wikipedia/commons/thumb/${original[1]}/${ANCHO}px-${original[2]}`;
  return u;
}

/** Página de Commons del archivo, para el crédito. */
export function paginaCommons(url: string): string {
  const archivo = decodeURIComponent((url.split('?')[0] as string).replace(/\/\d+px-[^/]+$/, '').split('/').pop() ?? '');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(archivo.replace(/ /g, '_'))}`;
}

/** Títulos de Wikipedia a probar, del más preciso al más general. */
export function titulosCandidatos(lugar: Lugar): string[] {
  const prov = lugar.provincia?.nombre;
  const muni = lugar.municipio?.nombre?.replace(/^(Municipalidad|Municipio|Comuna) de /i, '');
  if (muni) return [`${muni} (${prov})`, `Partido de ${muni}`, `${muni} (partido)`, `Departamento ${muni}`, muni];
  if (prov) return prov === 'Ciudad Autónoma de Buenos Aires' ? ['Buenos Aires'] : [`Provincia de ${prov} (Argentina)`, `Provincia de ${prov}`, prov];
  return ['Casa Rosada'];
}

/** Wikipedia cortó por exceso de pedidos: no es que el lugar no tenga foto, hay que volver a probar después. */
export class WikipediaLimitada extends Error {}

export function claveLugar(lugar: Lugar): string {
  return `${lugar.provincia?.nombre ?? ''}|${lugar.municipio?.nombre ?? ''}`;
}

/** Busca la foto en Wikipedia. Devuelve null si el lugar no tiene; tira WikipediaLimitada si nos cortaron. */
export async function buscarFoto(lugar: Lugar): Promise<FotoLugar | null> {
  const prov = lugar.provincia?.nombre;
  for (const titulo of titulosCandidatos(lugar)) {
    try {
      const r = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titulo.replace(/ /g, '_'))}`, {
        headers: { 'user-agent': 'Tramitando/0.1 (sitio de trámites públicos)' },
        signal: AbortSignal.timeout(2500),
      });
      if (r.status === 429) throw new WikipediaLimitada();
      if (!r.ok) continue;
      const j = (await r.json()) as { type?: string; extract?: string; originalimage?: { source: string } };
      if (j.type !== 'standard' || !j.originalimage) continue;
      // Que sea el lugar correcto y no otro con el mismo nombre en otra provincia.
      if (prov && lugar.municipio && !(j.extract ?? '').includes(prov) && !(j.extract ?? '').includes('Argentina')) continue;
      const fuente = j.originalimage.source;
      if (/\.svg/i.test(fuente)) continue; // mapas y escudos, no fotos
      // La miniatura falla si la original es más chica que ANCHO: en ese caso va la original.
      const chica = miniatura(fuente);
      const sirve = await fetch(chica, { method: 'HEAD', headers: { 'user-agent': 'Tramitando/0.1' }, signal: AbortSignal.timeout(2500) }).then((x) => x.ok).catch(() => false);
      return { url: sirve ? chica : (fuente.split('?')[0] as string), credito: paginaCommons(fuente), alt: `Foto de ${lugar.municipio?.nombre ?? prov ?? 'la Casa Rosada'}` };
    } catch (error) {
      if (error instanceof WikipediaLimitada) throw error;
      // Sin respuesta: se prueba el siguiente título.
    }
  }
  return null;
}

/**
 * Fotos ya buscadas una vez por scripts/fotos-lugares.ts: solo el link a Wikimedia (la imagen se sigue
 * sirviendo desde ahí), así cada ficha no le pregunta a Wikipedia y no nos corta por exceso de pedidos.
 * null = ese lugar no tiene foto en Wikipedia.
 */
const guardadas = fotosGuardadas as Record<string, FotoLugar | null>;

function deUnLugar(lugar: Lugar): Promise<FotoLugar | null> {
  const clave = claveLugar(lugar);
  if (clave in guardadas) return Promise.resolve(guardadas[clave] ?? null);
  let p = cache.get(clave);
  if (!p) {
    p = buscarFoto(lugar).catch(() => {
      // Si Wikipedia cortó, no se guarda el "sin foto": se vuelve a probar en el próximo pedido.
      cache.delete(clave);
      return null;
    });
    cache.set(clave, p);
  }
  return p;
}

/** Foto del municipio; si no tiene, la de su provincia. */
export async function fotoDeLugar(lugar: Lugar): Promise<FotoLugar | null> {
  const foto = await deUnLugar(lugar);
  if (foto || !lugar.municipio || !lugar.provincia) return foto;
  const deProvincia = await deUnLugar({ provincia: lugar.provincia });
  return deProvincia && { ...deProvincia, alt: `Foto de la provincia de ${lugar.provincia.nombre}` };
}
