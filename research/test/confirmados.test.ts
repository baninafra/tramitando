import { describe, expect, it } from 'vitest';
import { confirmarHost, esFuenteAceptada } from '../src/confirmados';

describe('esFuenteAceptada', () => {
  it('sigue aceptando lo oficial por dominio y rechaza lo ajeno', () => {
    expect(esFuenteAceptada('https://www.cba.gov.ar/guia')).toBe(true);
    expect(esFuenteAceptada('https://www.gestoria-municipal.com.ar/dni')).toBe(false);
  });

  it('acepta un host confirmado y sus subdominios, y nada más', () => {
    expect(esFuenteAceptada('https://www.muniprueba.com.ar/tramites')).toBe(false);
    confirmarHost('https://www.muniprueba.com.ar/');
    expect(esFuenteAceptada('https://www.muniprueba.com.ar/tramites')).toBe(true);
    expect(esFuenteAceptada('https://tramites.muniprueba.com.ar/')).toBe(true);
    expect(esFuenteAceptada('https://muniprueba.com.ar.ejemplo.com/')).toBe(false);
    expect(esFuenteAceptada('https://otramuni.com.ar/')).toBe(false);
  });

  it('rechaza protocolos que no son web', () => {
    confirmarHost('https://www.muniftp.com.ar/');
    expect(esFuenteAceptada('ftp://www.muniftp.com.ar/')).toBe(false);
  });
});
