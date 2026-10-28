/** Hash de IP con sal para los reportes. Nunca se guarda la IP en claro. */
export async function hashearIp(ip: string, sal: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sal}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
