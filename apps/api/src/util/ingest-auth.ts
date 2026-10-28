/** Autenticación de la investigación contra /ingest/v1. */

async function sha256(texto: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return new Uint8Array(digest);
}

/**
 * Compara dos strings en tiempo constante.
 *
 * Compara los digests (siempre 32 bytes) para no filtrar la longitud del token ni cortar en el
 * primer byte distinto.
 */
export async function compararTiempoConstante(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)]);
  let diferencia = 0;
  for (let i = 0; i < hashA.length; i += 1) {
    diferencia |= (hashA[i] ?? 0) ^ (hashB[i] ?? 0);
  }
  return diferencia === 0;
}

/** true si el header Authorization trae exactamente el token esperado como Bearer. */
export async function verificarTokenIngesta(cabecera: string | undefined, tokenEsperado: string): Promise<boolean> {
  if (!tokenEsperado) return false;
  const coincidencia = /^Bearer\s+(.+)$/i.exec(cabecera ?? '');
  if (!coincidencia?.[1]) return false;
  return compararTiempoConstante(coincidencia[1], tokenEsperado);
}
