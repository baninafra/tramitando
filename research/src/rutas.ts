import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta `research/data`, independiente del cwd desde el que se corra el CLI. */
export const DIR_DATOS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function rutaDatos(...partes: string[]): string {
  return resolve(DIR_DATOS, ...partes);
}
