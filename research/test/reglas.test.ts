import { describe, expect, it } from 'vitest';
import { clasificarPorReglas, esRuido } from '../src/reglas';

const h = 'www.ramallo.gob.ar';
const c = (url: string, texto: string) => clasificarPorReglas({ url, texto }, h);

describe('reglas de sitios municipales', () => {
  it('reconoce fichas de trámites', () => {
    expect(c('https://www.ramallo.gob.ar/tramites/licencia-de-conducir', 'Licencia de conducir')).toBe('ficha');
    expect(c('https://www.ramallo.gob.ar/pages/multas/multas.php', 'Infracciones')).toBe('ficha');
  });

  it('reconoce secciones para recorrer y paginación', () => {
    expect(c('https://www.ramallo.gob.ar/tramites', 'Trámites')).toBe('listado');
    expect(c('https://www.ramallo.gob.ar/tramites?page=2', 'Siguiente')).toBe('listado');
  });

  it('descarta ruido y otros dominios', () => {
    expect(c('https://www.ramallo.gob.ar/servicios/farmacias', 'Farmacias de turno')).toBe('descartar');
    expect(c('https://www.ramallo.gob.ar/noticias/123', 'Inauguramos la plaza')).toBe('descartar');
    expect(c('https://www.facebook.com/ramallo', 'Facebook')).toBe('descartar');
    expect(c('https://www.ramallo.gob.ar/boletines', 'Boletines oficiales')).toBe('descartar');
    expect(esRuido({ url: 'https://x.gob.ar/gobierno/intendente', texto: 'Intendente' })).toBe(true);
  });

  it('deja como dudoso lo que no puede decidir', () => {
    expect(c('https://www.ramallo.gob.ar/pages/servicios/servicios_index.php', 'Servicios Públicos')).toBe('dudoso');
  });
});
