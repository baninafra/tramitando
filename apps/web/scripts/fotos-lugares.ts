/**
 * Busca una sola vez la foto de cada provincia y municipio en Wikipedia y guarda el link (no la imagen) en
 * src/data/fotos-lugares.json, que la web lee antes de preguntarle a Wikipedia. Va despacio para que
 * Wikipedia no corte; si corta igual, espera un minuto y sigue. Se puede cortar y relanzar: lo ya
 * buscado no se repite.
 *
 * Uso (desde apps/web): npx tsx scripts/fotos-lugares.ts <jurisdicciones.json>
 * El JSON es la salida de `wrangler d1 execute --json` con filas { nivel, nombre, provincia }.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buscarFoto, claveLugar, WikipediaLimitada, type FotoLugar } from '../src/lib/fotos';

const PAUSA_MS = 1500;
const ESPERA_LIMITE_MS = 60_000;
const salida = fileURLToPath(new URL('../src/data/fotos-lugares.json', import.meta.url));

interface Fila {
  nivel: 'provincia' | 'municipio';
  nombre: string;
  provincia: string | null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const filas = (JSON.parse(readFileSync(process.argv[2] as string, 'utf8')) as { results: Fila[] }[])[0]?.results ?? [];
const fotos = JSON.parse(readFileSync(salida, 'utf8')) as Record<string, FotoLugar | null>;
const guardar = () => writeFileSync(salida, `${JSON.stringify(fotos, null, 1)}\n`);

let hechas = 0;
for (const fila of filas) {
  const lugar = fila.nivel === 'provincia'
    ? { provincia: { nombre: fila.nombre } }
    : { provincia: { nombre: fila.provincia ?? '' }, municipio: { nombre: fila.nombre } };
  const clave = claveLugar(lugar);
  if (clave in fotos) continue;
  for (;;) {
    try {
      fotos[clave] = await buscarFoto(lugar);
      break;
    } catch (error) {
      if (!(error instanceof WikipediaLimitada)) throw error;
      console.log('Wikipedia cortó: espero un minuto');
      await dormir(ESPERA_LIMITE_MS);
    }
  }
  hechas += 1;
  if (hechas % 20 === 0) {
    guardar();
    console.log(`${hechas} lugares buscados (${Object.values(fotos).filter(Boolean).length} con foto)`);
  }
  await dormir(PAUSA_MS);
}
guardar();
console.log(`Listo: ${Object.keys(fotos).length} lugares, ${Object.values(fotos).filter(Boolean).length} con foto`);
