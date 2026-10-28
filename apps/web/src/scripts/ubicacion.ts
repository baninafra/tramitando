import { refrescarSelector } from './selector';

// Ubicación elegida por la persona. Se guarda solo en su navegador, sin cuenta.
const CLAVE = 'tramitando:ubicacion';
/** Se dispara en `document` cada vez que cambia la ubicación guardada. */
export const EVENTO = 'tramitando:ubicacion';

export interface UbicacionGuardada {
  prov: string;
  provNombre: string;
  muni?: string;
  muniNombre?: string;
}

export function leerUbicacion(): UbicacionGuardada | null {
  try {
    const u = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    return u && typeof u.prov === 'string' ? u : null;
  } catch {
    return null;
  }
}

export function guardarUbicacion(u: UbicacionGuardada | null) {
  try {
    if (u) localStorage.setItem(CLAVE, JSON.stringify(u));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* Navegación privada o almacenamiento bloqueado: seguimos sin guardar. */
  }
  document.dispatchEvent(new CustomEvent(EVENTO, { detail: u }));
}

export const nombreUbicacion = (u: UbicacionGuardada) => (u.muniNombre ? `${u.muniNombre}, ${u.provNombre}` : u.provNombre);

/** Lee la ubicación elegida en un par de <select> de provincia y municipio. */
export function desdeSelects(prov: HTMLSelectElement, muni: HTMLSelectElement): UbicacionGuardada | null {
  if (!prov.value) return null;
  return {
    prov: prov.value,
    provNombre: prov.selectedOptions[0].text,
    muni: muni.value || undefined,
    muniNombre: muni.value ? muni.selectedOptions[0].text : undefined,
  };
}

/** Muestra en el select de municipios solo los de la provincia elegida. */
export function filtrarMunicipios(prov: HTMLSelectElement, muni: HTMLSelectElement) {
  muni.querySelectorAll('optgroup').forEach((g) => {
    const visible = g.dataset.prov === prov.value;
    g.hidden = !visible;
    g.disabled = !visible;
  });
  const elegido = muni.selectedOptions[0]?.parentElement;
  if (elegido instanceof HTMLOptGroupElement && elegido.disabled) muni.value = '';
  // Sin municipios cargados para esa provincia, el selector queda deshabilitado.
  muni.disabled = !prov.value || !muni.querySelector('optgroup:not([disabled])');
  refrescarSelector(muni);
}

export function ponerEnSelects(u: UbicacionGuardada | null, prov: HTMLSelectElement, muni: HTMLSelectElement) {
  prov.value = u?.prov ?? '';
  refrescarSelector(prov);
  filtrarMunicipios(prov, muni);
  muni.value = u?.muni ?? '';
  refrescarSelector(muni);
}

const km = ([a, b]: number[], [c, d]: number[]) => {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos(((a + c) / 2) * r);
  const y = (c - a) * r;
  return Math.hypot(x, y) * 6371;
};

/**
 * Sugiere provincia y municipio a partir del GPS del navegador. La posición no sale del navegador.
 * Es aproximada (busca el municipio cargado más cercano, o la capital provincial más cercana), así que
 * solo completa los selects: la persona confirma.
 */
export function sugerirPorGps(prov: HTMLSelectElement, muni: HTMLSelectElement): Promise<'municipio' | 'provincia'> {
  return new Promise((resolver, rechazar) => {
    if (!('geolocation' in navigator)) return rechazar(new Error('sin-gps'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const yo = [coords.latitude, coords.longitude];
        const puntos = (sel: HTMLSelectElement) =>
          [...sel.querySelectorAll<HTMLOptionElement>('option[data-centro]')].map((o) => ({ o, d: km(yo, JSON.parse(o.dataset.centro!)) }));
        const muniCerca = puntos(muni).sort((a, b) => a.d - b.d)[0];
        if (muniCerca && muniCerca.d < 25) {
          prov.value = (muniCerca.o.parentElement as HTMLOptGroupElement).dataset.prov!;
          refrescarSelector(prov);
          filtrarMunicipios(prov, muni);
          muni.value = muniCerca.o.value;
          refrescarSelector(muni);
          return resolver('municipio');
        }
        const provCerca = puntos(prov).sort((a, b) => a.d - b.d)[0];
        if (!provCerca) return rechazar(new Error('sin-datos'));
        prov.value = provCerca.o.value;
        refrescarSelector(prov);
        filtrarMunicipios(prov, muni);
        muni.value = '';
        refrescarSelector(muni);
        resolver('provincia');
      },
      (e) => rechazar(e),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}
