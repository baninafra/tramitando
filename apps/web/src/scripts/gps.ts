import { sugerirPorGps } from './ubicacion';

/** Muestra y conecta el botón "Usar mi ubicación" dentro de un bloque con [data-campos-ubicacion]. */
export function conectarGps(raiz: ParentNode) {
  const caja = raiz.querySelector<HTMLElement>('[data-gps]');
  if (!caja || !('geolocation' in navigator)) return;
  const prov = raiz.querySelector<HTMLSelectElement>('[data-prov]')!;
  const muni = raiz.querySelector<HTMLSelectElement>('[data-muni]')!;
  const boton = caja.querySelector<HTMLButtonElement>('[data-gps-boton]')!;
  const estado = caja.querySelector<HTMLElement>('[data-gps-estado]')!;
  caja.hidden = false;
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    estado.textContent = 'Buscando dónde estás…';
    try {
      const nivel = await sugerirPorGps(prov, muni);
      estado.textContent = nivel === 'municipio'
        ? 'Listo. Revisá que sea tu lugar.'
        : 'Encontramos tu provincia aproximada. Revisala y elegí tu municipio si está.';
    } catch (e) {
      estado.textContent = (e as GeolocationPositionError).code === 1
        ? 'No nos diste permiso para ver tu ubicación. Elegila de la lista.'
        : 'No pudimos saber dónde estás. Elegí tu lugar de la lista.';
    } finally {
      boton.disabled = false;
    }
  });
}
