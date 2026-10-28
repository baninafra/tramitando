import { describe, expect, it } from 'vitest';
import { entradasDeRespuesta, extraerObjeto } from '../src/importar-web';

describe('importar-web', () => {
  it('extrae el JSON aunque venga entre bloques de código', () => {
    const r = extraerObjeto('Listo:\n```json\n{"tramites":[]}\n```');
    expect(r.tramites).toEqual([]);
  });

  it('solo deja pasar URLs de dominios oficiales', () => {
    const { validas, descartadas } = entradasDeRespuesta('prov-14', {
      guia_url: 'https://www.cba.gov.ar/guia',
      tramites: [
        { nombre_oficial: 'Licencia de conducir', url: 'https://www.cba.gov.ar/licencia', organismo: 'Tránsito' },
        { nombre_oficial: 'Licencia según un blog', url: 'https://www.blogdetramites.com/licencia' },
        { nombre_oficial: 'x', url: 'https://www.cba.gov.ar/corto' },
      ],
    });
    expect(validas.map((v) => v.url)).toEqual(['https://www.cba.gov.ar/licencia']);
    expect(validas[0]?.portal).toBe('https://www.cba.gov.ar/guia');
    expect(descartadas).toBe(2);
  });
});
