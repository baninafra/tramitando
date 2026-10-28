/** Huella estable de una fuente: sha-256 en hexadecimal del texto ya normalizado. */
export async function calcularHuella(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
