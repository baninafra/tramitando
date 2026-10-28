/**
 * Verificación de Turnstile.
 *
 * `fetchImpl` existe para poder mockear la red en los tests; en producción usa `fetch`.
 */
export async function verificarTurnstile(
  secret: string,
  token: string,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const cuerpo = new URLSearchParams({ secret, response: token });
  if (ip) cuerpo.set('remoteip', ip);

  try {
    const respuesta = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
    });
    if (!respuesta.ok) return false;
    const datos = (await respuesta.json()) as { success?: boolean };
    return datos.success === true;
  } catch {
    return false;
  }
}
