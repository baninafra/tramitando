import { describe, expect, it } from 'vitest';
import { cerrarNavegador, decidirPedido, renderizar } from '../src/navegador.js';

describe('decidirPedido (page.route)', () => {
  it('bloquea imágenes, fuentes y media para que la página sea liviana', () => {
    for (const recurso of ['image', 'font', 'media']) {
      expect(decidirPedido(recurso, 'https://tramites.chaco.gob.ar/logo.png')).toBe('abortar');
    }
  });

  it('aborta cualquier documento a un host no oficial, incluidas las redirecciones', () => {
    expect(decidirPedido('document', 'https://sitio-ajeno.com/tramite')).toBe('abortar');
    expect(decidirPedido('document', 'http://ejemplo.com/')).toBe('abortar');
    expect(decidirPedido('document', 'no-es-una-url')).toBe('abortar');
  });

  it('permite documentos oficiales del .gob.ar', () => {
    expect(decidirPedido('document', 'https://tramites.chaco.gob.ar/')).toBe('continuar');
    expect(decidirPedido('document', 'https://www.argentina.gob.ar/tramites')).toBe('continuar');
  });

  it('permite scripts, XHR y estilos de terceros: la página los necesita para armarse', () => {
    expect(decidirPedido('script', 'https://cdn.ajeno.com/app.js')).toBe('continuar');
    expect(decidirPedido('xhr', 'https://api.ajeno.com/tramites')).toBe('continuar');
    expect(decidirPedido('fetch', 'https://api.ajeno.com/datos')).toBe('continuar');
    expect(decidirPedido('stylesheet', 'https://cdn.ajeno.com/app.css')).toBe('continuar');
  });
});

describe('renderizar', () => {
  it('rechaza una URL no oficial sin abrir el navegador', async () => {
    await expect(renderizar('https://sitio-ajeno.com/')).rejects.toThrow(/no oficial/i);
  });
});

describe('cerrarNavegador', () => {
  it('es seguro llamarlo aunque nunca se haya abierto el navegador', async () => {
    await expect(cerrarNavegador()).resolves.toBeUndefined();
  });
});
