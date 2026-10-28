/**
 * Hosts de sitios municipales que Gemini confirmó como oficiales aunque no terminen en .gob.ar / .gov.ar
 * (por ejemplo, un .com.ar o un .com del propio municipio). Solo viven en el proceso que los confirma:
 * municipio-local --confirmado agrega su host, y ningún otro proceso lo ve. `esUrlOficial()` del
 * paquete compartido no cambia: esta excepción es local a la investigación.
 */
import { esUrlOficial } from '@tramitando/shared';

const hostsConfirmados = new Set<string>();

/** Confirma el dominio de un sitio, sin "www.", y sus subdominios, para este proceso. */
export function confirmarHost(url: string): void {
  hostsConfirmados.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ''));
}

/** true si la URL es oficial por dominio, o si su host fue confirmado para este proceso. */
export function esFuenteAceptada(url: string): boolean {
  if (esUrlOficial(url)) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return [...hostsConfirmados].some((h) => host === h || host.endsWith(`.${h}`));
}
