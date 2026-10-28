import { describe, expect, it } from 'vitest';
import { crawlearPortal } from '../src/crawler.js';
import type { Descarga, OpcionesDescarga } from '../src/descargar.js';

function descarga(url: string, cuerpo: string): Descarga {
  return {
    url,
    url_final: url,
    status: 200,
    content_type: 'text/html',
    fecha: '2026-10-22T00:00:00.000Z',
    cuerpo,
    tipo: 'html',
    desde_cache: false,
  };
}

const GUIA = 'https://www.portaltest.gob.ar/tramites';
const PAGINA_2 = 'https://www.portaltest.gob.ar/tramites?page=2';

function respuesta(
  url: string,
  cuerpo: string,
  opciones: { status?: number; tipo?: Descarga['tipo']; contentType?: string } = {},
): Descarga {
  return {
    url,
    url_final: url,
    status: opciones.status ?? 200,
    content_type: opciones.contentType ?? 'text/html',
    fecha: '2026-10-22T00:00:00.000Z',
    cuerpo,
    tipo: opciones.tipo ?? 'html',
    desde_cache: false,
  };
}

const PAGINAS = new Map<string, string>([
  [
    GUIA,
    `<html><head><title>Trámites</title></head><body>
      <a href="/tramites/dni">Sacar el DNI</a>
      <a href="/tramites/licencia-de-conducir">Licencia de conducir</a>
      <a href="/tramites?page=2">Siguiente</a>
      <a href="/otros/consulta">Otra cosa</a>
    </body></html>`,
  ],
  [
    PAGINA_2,
    `<html><head><title>Trámites página 2</title></head><body>
      <a href="/tramites/pasaporte">Pasaporte</a>
      <a href="/tramites/dni">Sacar el DNI</a>
      <a href="/tramites?page=3">Siguiente</a>
    </body></html>`,
  ],
  [
    'https://www.portaltest.gob.ar/tramites/pasaporte',
    '<html><body>trámite de pasaporte</body></html>',
  ],
]);

describe('crawlearPortal', () => {
  it('sigue la paginación, no sale del prefijo y junta solo las URLs que matchean', async () => {
    const visitadas: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      visitadas.push(url);
      const cuerpo = PAGINAS.get(url);
      if (!cuerpo) throw new Error(`página inesperada: ${url}`);
      return descarga(url, cuerpo);
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: GUIA,
        listado_urls: [GUIA],
        regex_fichas: '/tramites/[a-z-]+$',
      },
      { descargar },
    );

    expect(visitadas).toContain(PAGINA_2);
    expect(visitadas.some((url) => url.includes('/otros/'))).toBe(false);
    expect(visitadas.some((url) => url.includes('/tramites/dni'))).toBe(false);

    const urls = entradas.map((entrada) => entrada.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://www.portaltest.gob.ar/tramites/dni',
        'https://www.portaltest.gob.ar/tramites/licencia-de-conducir',
        'https://www.portaltest.gob.ar/tramites/pasaporte',
      ]),
    );
    expect(urls).toHaveLength(3);
    expect(urls.some((url) => url.includes('/otros/'))).toBe(false);
    expect(entradas.find((e) => e.url.endsWith('/dni'))?.nombre_oficial).toBe('Sacar el DNI');
    expect(entradas.every((e) => e.jurisdiccion_id === 'nacion')).toBe(true);
  });

  it('respeta el máximo de páginas', async () => {
    const descargar = async (url: string): Promise<Descarga> => {
      if (url === GUIA) {
        return descarga(
          url,
          `<html><body>
            <a href="/tramites/uno">Uno</a>
            <a href="/tramites?page=2">Dos</a>
          </body></html>`,
        );
      }
      return descarga(url, '<html><body><a href="/tramites/tres">Tres</a></body></html>');
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: GUIA,
        listado_urls: [GUIA],
        regex_fichas: '/tramites/[a-z]+$',
      },
      { descargar, maxPaginas: 1 },
    );

    expect(entradas.map((e) => e.url)).toEqual(['https://www.portaltest.gob.ar/tramites/uno']);
  });

  it('junta una ficha /servicio aunque la guía sea /tad', async () => {
    const guia = 'https://www.portaltest.gob.ar/tad';
    const paginas = new Map<string, string>([
      [
        guia,
        `<html><head><title>Trámites</title></head><body>
          <a href="/servicio/documento-nacional-de-identidad">Sacar el DNI</a>
          <a href="/tad/como-funciona">Cómo funciona</a>
        </body></html>`,
      ],
      ['https://www.portaltest.gob.ar/tad/como-funciona', '<html><body>info</body></html>'],
    ]);
    const visitadas: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      visitadas.push(url);
      if (url.endsWith('/robots.txt')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      if (url.endsWith('/sitemap.xml')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      const cuerpo = paginas.get(url);
      if (!cuerpo) throw new Error(`página inesperada: ${url}`);
      return respuesta(url, cuerpo);
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: guia,
        listado_urls: [guia],
        regex_fichas: '^https://www\\.portaltest\\.gob\\.ar/servicio/[a-z0-9-]+$',
      },
      { descargar },
    );

    const ficha = entradas.find((e) => e.url.endsWith('/servicio/documento-nacional-de-identidad'));
    expect(ficha?.nombre_oficial).toBe('Sacar el DNI');
    expect(visitadas).toContain('https://www.portaltest.gob.ar/tad/como-funciona');
    expect(visitadas).not.toContain(
      'https://www.portaltest.gob.ar/servicio/documento-nacional-de-identidad',
    );
  });

  it('solo visita páginas bajo los prefijos de la guía, los listados y las categorías', async () => {
    const guia = 'https://www.portaltest.gob.ar/tramites';
    const categoria = 'https://www.portaltest.gob.ar/temas/documentacion';
    const paginas = new Map<string, string>([
      [
        guia,
        `<html><body>
          <a href="/tramites/dni">Sacar el DNI</a>
          <a href="/otros/consulta">Otra cosa</a>
        </body></html>`,
      ],
      [
        categoria,
        `<html><body>
          <a href="/temas/documentacion/registro-civil">Registro civil</a>
          <a href="/lugares/registro">Dónde queda</a>
        </body></html>`,
      ],
      [
        'https://www.portaltest.gob.ar/temas/documentacion/registro-civil',
        '<html><body><a href="/otra/seccion">Fuera</a></body></html>',
      ],
    ]);
    const visitadas: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      visitadas.push(url);
      if (url.endsWith('/robots.txt')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      if (url.endsWith('/sitemap.xml')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      const cuerpo = paginas.get(url);
      if (!cuerpo) throw new Error(`página inesperada: ${url}`);
      return respuesta(url, cuerpo);
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: guia,
        listado_urls: [guia],
        categorias_urls: [categoria],
        regex_fichas: '/tramites/[a-z-]+$',
      },
      { descargar },
    );

    expect(visitadas).toContain(categoria);
    expect(visitadas).toContain('https://www.portaltest.gob.ar/temas/documentacion/registro-civil');
    expect(visitadas.some((url) => url.includes('/otros/'))).toBe(false);
    expect(visitadas.some((url) => url.includes('/lugares/'))).toBe(false);
    expect(visitadas.some((url) => url.includes('/otra/'))).toBe(false);
    expect(entradas.map((e) => e.url)).toEqual(['https://www.portaltest.gob.ar/tramites/dni']);
  });

  it('sin Sitemap en robots prueba /sitemap.xml y si da 404 sigue con el BFS', async () => {
    const visitadas: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      visitadas.push(url);
      if (url === 'https://www.portaltest.gob.ar/robots.txt') {
        return respuesta(url, 'User-agent: *\nAllow: /\n', { tipo: 'texto', contentType: 'text/plain' });
      }
      if (url === 'https://www.portaltest.gob.ar/sitemap.xml') {
        return respuesta(url, '', { status: 404, tipo: 'texto' });
      }
      if (url === GUIA) {
        return respuesta(url, '<html><body><a href="/tramites/dni">Sacar el DNI</a></body></html>');
      }
      throw new Error(`página inesperada: ${url}`);
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: GUIA,
        listado_urls: [GUIA],
        regex_fichas: '/tramites/[a-z-]+$',
      },
      { descargar },
    );

    expect(visitadas).toContain('https://www.portaltest.gob.ar/sitemap.xml');
    expect(entradas.map((e) => e.url)).toEqual(['https://www.portaltest.gob.ar/tramites/dni']);
  });

  it('suma las fichas del sitemap aunque no estén enlazadas y reporta el recuento', async () => {
    const progreso: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      if (url === 'https://www.portaltest.gob.ar/robots.txt') {
        return respuesta(
          url,
          'User-agent: *\nSitemap: https://www.portaltest.gob.ar/sitemap.xml\n',
          { tipo: 'texto', contentType: 'text/plain' },
        );
      }
      if (url === 'https://www.portaltest.gob.ar/sitemap.xml') {
        return respuesta(
          url,
          `<urlset>
            <url><loc>https://www.portaltest.gob.ar/servicio/pasaporte</loc></url>
          </urlset>`,
          { tipo: 'texto', contentType: 'application/xml' },
        );
      }
      if (url === GUIA) {
        return respuesta(url, '<html><body><a href="/tramites/dni">Sacar el DNI</a></body></html>');
      }
      throw new Error(`página inesperada: ${url}`);
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: GUIA,
        listado_urls: [GUIA],
        regex_fichas: '/(?:tramites|servicio)/[a-z-]+$',
      },
      { descargar, alProgreso: (mensaje) => progreso.push(mensaje) },
    );

    expect(entradas.map((e) => e.url).sort()).toEqual([
      'https://www.portaltest.gob.ar/servicio/pasaporte',
      'https://www.portaltest.gob.ar/tramites/dni',
    ]);
    expect(progreso).toContain('  fichas: 1 del sitemap, 1 del BFS (2 total)');
  });

  it('reintenta con render cuando la página HTML tiene pocos links y poco texto', async () => {
    const llamadas: { url: string; render: boolean }[] = [];
    const descargar = async (url: string, opciones?: OpcionesDescarga): Promise<Descarga> => {
      llamadas.push({ url, render: opciones?.renderizar === true });
      if (url.endsWith('/robots.txt')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      if (url.endsWith('/sitemap.xml')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      if (url === GUIA) {
        return opciones?.renderizar
          ? respuesta(
              url,
              `<html><head><title>Trámites</title></head><body>
                <a href="/tramites/uno">Uno</a>
                <a href="/tramites/dos">Dos</a>
                <a href="/tramites/tres">Tres</a>
                <a href="/tramites/cuatro">Cuatro</a>
                <a href="/tramites?page=2">Siguiente</a>
              </body></html>`,
            )
          : respuesta(
              url,
              '<html><head><title>Trámites</title></head><body><div id="app"></div></body></html>',
            );
      }
      if (url === PAGINA_2) {
        return opciones?.renderizar
          ? respuesta(url, '<html><body><a href="/tramites/cinco">Cinco</a></body></html>')
          : respuesta(url, '<html><body><div id="app"></div></body></html>');
      }
      throw new Error(`página inesperada: ${url}`);
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: GUIA,
        listado_urls: [GUIA],
        regex_fichas: '/tramites/[a-z]+$',
      },
      { descargar },
    );

    expect(llamadas).toContainEqual({ url: GUIA, render: true });
    expect(llamadas).toContainEqual({ url: PAGINA_2, render: true });
    expect(entradas.map((e) => e.url).sort()).toEqual([
      'https://www.portaltest.gob.ar/tramites/cinco',
      'https://www.portaltest.gob.ar/tramites/cuatro',
      'https://www.portaltest.gob.ar/tramites/dos',
      'https://www.portaltest.gob.ar/tramites/tres',
      'https://www.portaltest.gob.ar/tramites/uno',
    ]);
  });

  it('no pide render si la página ya trae contenido suficiente', async () => {
    const llamadas: string[] = [];
    const textoLargo = 'Trámite de ejemplo con contenido. '.repeat(30);
    const descargar = async (url: string, opciones?: OpcionesDescarga): Promise<Descarga> => {
      if (url.endsWith('/robots.txt')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      if (url.endsWith('/sitemap.xml')) return respuesta(url, '', { status: 404, tipo: 'texto' });
      if (opciones?.renderizar) llamadas.push(url);
      return respuesta(
        url,
        `<html><body>
          <p>${textoLargo}</p>
          <a href="/tramites/uno">Uno</a>
          <a href="/tramites/dos">Dos</a>
          <a href="/tramites/tres">Tres</a>
          <a href="/tramites/cuatro">Cuatro</a>
          <a href="/tramites/cinco">Cinco</a>
        </body></html>`,
      );
    };

    const entradas = await crawlearPortal(
      {
        jurisdiccion_id: 'nacion',
        nombre: 'Nación',
        guia_url: GUIA,
        listado_urls: [GUIA],
        regex_fichas: '/tramites/[a-z]+$',
      },
      { descargar },
    );

    expect(llamadas).toEqual([]);
    expect(entradas).toHaveLength(5);
  });
});
