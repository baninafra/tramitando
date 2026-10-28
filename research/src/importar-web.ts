/**
 * Importa al catálogo lo que relevó Gemini navegando la web (research/scripts/gemini-web.sh).
 *
 * Cada archivo de data/gemini-web/<jurisdiccion_id>.json es el sobre de agy-delegate. Solo entran
 * trámites con URL de dominio oficial (`esUrlOficial`) y que validan como `EntradaCatalogo`; se suman
 * a data/catalogo/<jurisdiccion_id>.json sin repetir URLs.
 *
 * Uso: npx tsx research/src/importar-web.ts
 */
import { EntradaCatalogo, esUrlOficial } from '@tramitando/shared';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { respuestaDelSobre } from './gemini.js';
import { rutaDatos } from './rutas.js';

interface RespuestaWeb {
  jurisdiccion_id?: string;
  guia_url?: string | null;
  notas?: string;
  tramites?: { nombre_oficial?: string; url?: string; organismo?: string | null }[];
}

/** Extrae el primer objeto JSON de un texto (puede venir entre ``` o con texto alrededor). */
export function extraerObjeto(texto: string): RespuestaWeb {
  const sinBloques = texto.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');
  const inicio = sinBloques.indexOf('{');
  const fin = sinBloques.lastIndexOf('}');
  if (inicio === -1 || fin <= inicio) throw new Error('No hay un objeto JSON en la respuesta');
  return JSON.parse(sinBloques.slice(inicio, fin + 1)) as RespuestaWeb;
}

/** Convierte la respuesta de Gemini en entradas de catálogo válidas y oficiales. */
export function entradasDeRespuesta(jurisdiccionId: string, r: RespuestaWeb) {
  const validas: EntradaCatalogo[] = [];
  let descartadas = 0;
  for (const t of r.tramites ?? []) {
    const url = (t.url ?? '').trim().replace(/#.*$/, '');
    const candidata = {
      url,
      nombre_oficial: (t.nombre_oficial ?? '').trim().slice(0, 300),
      jurisdiccion_id: jurisdiccionId,
      organismo: t.organismo?.trim() || null,
      temas_sugeridos: [],
      portal: r.guia_url && esUrlOficial(r.guia_url) ? r.guia_url : 'gemini-web',
    };
    const ok = esUrlOficial(url) && EntradaCatalogo.safeParse(candidata).success;
    if (ok) validas.push(EntradaCatalogo.parse(candidata));
    else descartadas += 1;
  }
  return { validas, descartadas };
}

function main() {
  const dir = rutaDatos('gemini-web');
  const resumen: string[] = [];
  for (const archivo of readdirSync(dir).filter((a) => a.endsWith('.json')).sort()) {
    const id = archivo.replace(/\.json$/, '');
    let respuesta: RespuestaWeb;
    try {
      respuesta = extraerObjeto(respuestaDelSobre(readFileSync(`${dir}/${archivo}`, 'utf8')));
    } catch (error) {
      resumen.push(`${id}: sin respuesta usable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const { validas, descartadas } = entradasDeRespuesta(id, respuesta);
    const destino = rutaDatos('catalogo', `${id}.json`);
    const previas: EntradaCatalogo[] = existsSync(destino) ? JSON.parse(readFileSync(destino, 'utf8')) : [];
    const urls = new Set(previas.map((e) => e.url));
    const nuevas = validas.filter((e) => !urls.has(e.url) && urls.add(e.url));
    writeFileSync(destino, JSON.stringify([...previas, ...nuevas], null, 2));
    resumen.push(`${id}: ${nuevas.length} nuevas, ${descartadas} descartadas (no oficiales o inválidas), total ${previas.length + nuevas.length}`);
  }
  console.log(resumen.join('\n'));
}

if (process.argv[1]?.endsWith('importar-web.ts')) main();
