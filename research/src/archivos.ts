import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function leerJson<T>(ruta: string): Promise<T> {
  return JSON.parse(await readFile(ruta, 'utf8')) as T;
}

export async function escribirJson(ruta: string, valor: unknown): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, `${JSON.stringify(valor, null, 2)}\n`, 'utf8');
}

export async function listarJson(dir: string): Promise<string[]> {
  try {
    const entradas = await readdir(dir);
    return entradas.filter((nombre) => nombre.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export function esperarLinea(mensaje: string): void {
  process.stdout.write(`${mensaje}\n`);
}
