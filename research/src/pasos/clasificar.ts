import { EntradaCatalogo } from '@tramitando/shared';
import { z } from 'zod';
import { escribirJson, esperarLinea, leerJson, listarJson } from '../archivos.js';
import { slugsDeTemas, Temario } from '../esquemas.js';
import type { Preguntar } from '../fichas.js';
import { temasPorReglas } from '../reglas.js';
import { rutaDatos } from '../rutas.js';

export interface OpcionesPasoClasificar {
  jurisdiccion?: string;
  preguntar: Preguntar;
  dirCatalogo?: string;
  temasPath?: string;
  tamanoTanda?: number;
  /** También vuelve a mandar las entradas que quedaron con temas vacíos (por defecto solo las nunca clasificadas). */
  rehacerVacios?: boolean;
  /** Embeddings normalizados (Qwen3-Embedding local). Sin esto, todo lo que no resuelven las reglas va al modelo. */
  embeber?: Embeber;
}

/** Devuelve un vector por texto. `consulta` distingue los nombres de trámites (consultas) de los temas (documentos). */
export type Embeber = (textos: string[], consulta: boolean) => Promise<number[][]>;

/** Similitud desde la que el tema más cercano por embeddings se asigna sin preguntarle al modelo (calibrado contra el 9B). */
export const UMBRAL_EMBEDDINGS = 0.52;
const producto = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] as number), 0);

/** El modelo responde por número de trámite, sin repetir URLs: {"t":{"1":["slug"],"2":[]}}. */
const RespuestaPorNumero = z.object({ t: z.record(z.string(), z.array(z.string()).default([])) });

type Cruda = Record<string, unknown> & { temas_sugeridos?: string[] };
type Pendiente = { c: Cruda; e: EntradaCatalogo };

/**
 * Asigna `temas_sugeridos` solo a las entradas pendientes (las que no tienen la clave): primero por
 * reglas y lo que queda con el modelo, en tandas chicas. Las que el modelo omite siguen pendientes
 * para la próxima corrida. Los archivos sin pendientes no se tocan.
 */
export async function pasoClasificar(opciones: OpcionesPasoClasificar): Promise<number> {
  const temario = Temario.parse(await leerJson(opciones.temasPath ?? rutaDatos('temas.json')));
  const slugs = new Set(slugsDeTemas(temario));
  const dir = opciones.dirCatalogo ?? rutaDatos('catalogo');
  const archivos = await listarJson(dir);
  const tamano = opciones.tamanoTanda ?? 25;
  let clasificadas = 0;
  let porReglas = 0;
  let porEmbeddings = 0;

  // Subtemas con su tema padre, embebidos una sola vez por corrida. Si el servidor no está, se sigue sin embeddings.
  const subtemas = temario.temas.flatMap((t) => t.subtemas.map((s) => ({ slug: s.slug, padre: t.slug, texto: `${t.nombre} — ${s.nombre}: ${s.descripcion}` })));
  let vectoresTemas: number[][] | null = null;
  let embeber = opciones.embeber;
  if (embeber) {
    try {
      vectoresTemas = await embeber(subtemas.map((s) => s.texto), false);
    } catch (error) {
      esperarLinea(`  sin embeddings (${error instanceof Error ? error.message.slice(0, 80) : error}): todo va al modelo`);
      embeber = undefined;
    }
  }

  for (const archivo of archivos) {
    const jurisdiccion = archivo.replace(/\.json$/, '');
    if (opciones.jurisdiccion && jurisdiccion !== opciones.jurisdiccion) continue;
    const crudas = await leerJson<Cruda[]>(`${dir}/${archivo}`);
    const entradas = EntradaCatalogo.array().parse(crudas);
    const pendientes = crudas
      .map((c, i) => ({ c, e: entradas[i] as EntradaCatalogo }))
      .filter(({ c }) => !('temas_sugeridos' in c) || (opciones.rehacerVacios && !c.temas_sugeridos?.length));
    if (!pendientes.length) continue;
    esperarLinea(`→ ${jurisdiccion}: ${pendientes.length} de ${crudas.length} entradas pendientes`);

    let paraModelo: Pendiente[] = [];
    for (const p of pendientes) {
      const temas = temasPorReglas(p.e.nombre_oficial, slugs);
      if (temas.length) {
        p.c.temas_sugeridos = temas;
        porReglas += 1;
        clasificadas += 1;
      } else paraModelo.push(p);
    }

    // Embeddings: lo muy parecido a un subtema se asigna directo; el resto lo decide el modelo con la lista completa.
    // (Pasarle solo los subtemas más cercanos empeoró: cuando ninguno encaja, elige uno malo en vez de dejarlo vacío.)
    if (embeber && vectoresTemas && paraModelo.length) {
      try {
        const vectores = await embeber(paraModelo.map(({ e }) => e.nombre_oficial.slice(0, 200)), true);
        const dudosos: Pendiente[] = [];
        paraModelo.forEach((p, i) => {
          const orden = (vectoresTemas as number[][])
            .map((v, k) => [producto(v, vectores[i] as number[]), k] as const)
            .sort((a, b) => b[0] - a[0]);
          const mejor = subtemas[orden[0]![1]]!;
          if (orden[0]![0] >= UMBRAL_EMBEDDINGS && slugs.has(mejor.slug)) {
            p.c.temas_sugeridos = [mejor.slug, mejor.padre].filter((s) => slugs.has(s));
            porEmbeddings += 1;
            clasificadas += 1;
          } else dudosos.push(p);
        });
        paraModelo = dudosos;
      } catch (error) {
        esperarLinea(`  embeddings fallaron en ${jurisdiccion}: ${error instanceof Error ? error.message.slice(0, 80) : error}`);
      }
    }

    for (let i = 0; i < paraModelo.length; i += tamano) {
      const tanda = paraModelo.slice(i, i + tamano);
      const prompt = [
        'Sos un clasificador de trámites públicos de la Argentina. NO navegues.',
        'Asigná a cada trámite el subtema más específico que le corresponda y su tema padre (máximo 3 slugs).',
        'Decidí cada trámite por separado: no copies los temas del anterior. Usá SOLO estos slugs.',
        'Si ninguno encaja (noticias, ordenanzas, institucional), devolvé una lista vacía para ese número.',
        '',
        'Temas (tema: subtemas):',
        ...temario.temas.map((t) => `${t.slug}: ${t.subtemas.map((x) => x.slug).join(', ')}`),
        '',
        'Trámites:',
        ...tanda.map(({ e }, n) => `${n + 1}. ${e.nombre_oficial.slice(0, 120)} :: ${new URL(e.url).pathname.slice(0, 80)}`),
        '',
        `Respondé SOLO con JSON con los ${tanda.length} números: {"t":{"1":["slug"],"2":[]}}`,
      ].join('\n');

      let respuesta: z.infer<typeof RespuestaPorNumero>;
      try {
        respuesta = await opciones.preguntar(prompt, RespuestaPorNumero);
      } catch (error) {
        // Una tanda fallida no frena el resto: esas entradas siguen pendientes.
        esperarLinea(`  tanda ${i / tamano + 1} falló: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
        continue;
      }
      let enTanda = 0;
      tanda.forEach(({ c }, n) => {
        const asignados = respuesta.t[String(n + 1)];
        if (!asignados) return;
        c.temas_sugeridos = [...new Set(asignados.filter((slug) => slugs.has(slug)))].slice(0, 4);
        enTanda += 1;
        clasificadas += 1;
      });
      esperarLinea(`  ${Math.min(i + tamano, paraModelo.length)}/${paraModelo.length} con el modelo (${enTanda} asignadas)`);
    }

    await escribirJson(`${dir}/${archivo}`, crudas);
  }

  esperarLinea(`Clasificadas ${clasificadas} entradas (${porReglas} por reglas, ${porEmbeddings} por embeddings)`);
  return clasificadas;
}
