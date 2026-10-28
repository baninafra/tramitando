import { describe, expect, it } from 'vitest';
import { respuestaDelSobre } from '../src/gemini';

describe('respuestaDelSobre', () => {
  it('devuelve el campo response del sobre de agy-delegate', () => {
    const stdout = JSON.stringify({ status: 'SUCCESS', response: '{"guia_url":"https://www.argentina.gob.ar/tramites"}\n' });
    expect(respuestaDelSobre(stdout)).toBe('{"guia_url":"https://www.argentina.gob.ar/tramites"}\n');
  });

  it('falla con una respuesta vacía y nombra la acción denegada', () => {
    const stdout = JSON.stringify({ status: 'SUCCESS', response: '', denied_actions: [{ action: 'command' }] });
    expect(() => respuestaDelSobre(stdout)).toThrow(/intentó usar: command/);
  });

  it('deja pasar texto que no es un sobre', () => {
    expect(respuestaDelSobre('hola')).toBe('hola');
  });
});

describe('rutaWsl', () => {
  it('convierte rutas de Windows a /mnt', async () => {
    const { rutaWsl } = await import('../src/gemini');
    expect(rutaWsl(String.raw`C:\Users\x\Temp\p.txt`)).toBe('/mnt/c/Users/x/Temp/p.txt');
    expect(() => rutaWsl('/ya/es/linux')).toThrow();
  });
});
