/**
 * Embeddings locales con Qwen3-Embedding 0.6B en llama-server (`qwen-servidor.sh embed`, puerto 8645).
 * Los vectores vuelven normalizados, así el producto escalar es la similitud coseno.
 */
import type { Embeber } from './pasos/clasificar.js';

export const URL_EMBEDDINGS = process.env.TRAMITANDO_EMBED_URL ?? 'http://127.0.0.1:8645/v1/embeddings';

/** Qwen3-Embedding pide una instrucción en las consultas; los documentos (temas) van tal cual. */
const INSTRUCCION =
  'Instruct: Dado el nombre de un trámite o servicio de un municipio argentino, encontrá la categoría de trámites a la que pertenece\nQuery: ';

export const embeberLocal: Embeber = async (textos, consulta) => {
  const vectores: number[][] = [];
  for (let i = 0; i < textos.length; i += 128) {
    const respuesta = await fetch(URL_EMBEDDINGS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ input: textos.slice(i, i + 128).map((t) => (consulta ? INSTRUCCION + t : t)) }),
    });
    if (!respuesta.ok) throw new Error(`embeddings respondió ${respuesta.status}`);
    const datos = (await respuesta.json()) as { data?: { index: number; embedding: number[] }[] };
    for (const d of [...(datos.data ?? [])].sort((a, b) => a.index - b.index)) {
      const norma = Math.hypot(...d.embedding) || 1;
      vectores.push(d.embedding.map((x) => x / norma));
    }
  }
  if (vectores.length !== textos.length) throw new Error('embeddings devolvió menos vectores que textos');
  return vectores;
};
