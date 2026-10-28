import { describe, expect, it } from 'vitest';
import { esUrlOficial } from './index';

describe('esUrlOficial', () => {
  it('acepta dominios .gob.ar y .gov.ar', () => {
    expect(esUrlOficial('https://www.argentina.gob.ar/tramites')).toBe(true);
    expect(esUrlOficial('https://www.cba.gov.ar/guia')).toBe(true);
    expect(esUrlOficial('https://boletinoficial.gob.ar/')).toBe(true);
  });

  it('rechaza dominios que solo se parecen', () => {
    expect(esUrlOficial('https://gob.ar.ejemplo.com/')).toBe(false);
    expect(esUrlOficial('https://tramitesgob.ar/')).toBe(false);
    expect(esUrlOficial('https://www.gestoria.com.ar/dni')).toBe(false);
    expect(esUrlOficial('ftp://argentina.gob.ar/')).toBe(false);
    expect(esUrlOficial('no es una url')).toBe(false);
  });
});
