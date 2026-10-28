import { describe, expect, it } from 'vitest';
import { crawlearPortal } from '../src/crawler';
import type { Descarga } from '../src/descargar';

const html = (cuerpo: string) => `<html><head><title>Guía</title></head><body>${cuerpo}</body></html>`;

describe('crawler con redirección de host', () => {
  it('sigue al host final de la guía y saca los parámetros utm', async () => {
    const paginas: Record<string, { final: string; cuerpo: string }> = {
      'http://guia.prov.gov.ar/': {
        final: 'https://guia.prov.gob.ar/',
        cuerpo: html(
          '<a href="https://guia.prov.gob.ar/tramite/1/dni.html?utm_source=home">DNI</a>' +
            '<a href="https://guia.prov.gob.ar/tramite/1/dni.html?utm_source=lista">DNI otra vez</a>',
        ),
      },
    };
    const descargar = async (url: string): Promise<Descarga> => {
      const p = paginas[url] ?? paginas[url.replace('https://guia.prov.gob.ar/', 'http://guia.prov.gov.ar/')];
      if (!p) throw new Error(`404 ${url}`);
      return { url, url_final: p.final, status: 200, tipo: 'html', cuerpo: p.cuerpo } as unknown as Descarga;
    };
    const fichas = await crawlearPortal(
      {
        jurisdiccion_id: 'prov-90',
        nombre: 'Prueba',
        guia_url: 'http://guia.prov.gov.ar/',
        listado_urls: [],
        regex_fichas: '^https://guia\\.prov\\.gob\\.ar/tramite/\\d+/[a-z-]+\\.html',
      },
      { descargar },
    );
    expect(fichas.map((f) => f.url)).toEqual(['https://guia.prov.gob.ar/tramite/1/dni.html']);
  });
});
