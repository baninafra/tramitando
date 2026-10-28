import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { descargar } from '../src/descargar.js';

function falso(manejador: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) =>
    manejador(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)) as typeof fetch;
}

const temporales: string[] = [];

async function dirTemporal(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tramitando-descargar-'));
  temporales.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('descargar', () => {
  it('rechaza dominios que no son oficiales sin hacer ningún pedido', async () => {
    let llamadas = 0;
    const fetchFalso = falso(() => {
      llamadas += 1;
      return new Response('ok');
    });
    await expect(
      descargar('https://ejemplo.com/tramite', { fetch: fetchFalso, robotsCache: new Map() }),
    ).rejects.toThrow(/no oficial/i);
    expect(llamadas).toBe(0);
  });

  it('rechaza una redirección a un dominio no oficial', async () => {
    const fetchFalso = falso((url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(null, {
        status: 302,
        headers: { location: 'https://sitio-ajeno.com/tramite' },
      });
    });
    await expect(
      descargar('https://www.argentina.gob.ar/tramites', {
        fetch: fetchFalso,
        robotsCache: new Map(),
        intervaloHostMs: 0,
        reintentos: 0,
      }),
    ).rejects.toThrow(/no oficial/i);
  });

  it('respeta robots.txt', async () => {
    let pedidosDePagina = 0;
    const fetchFalso = falso((url) => {
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /privado\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      pedidosDePagina += 1;
      return new Response('<html><body>hola</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    });

    await expect(
      descargar('https://www.argentina.gob.ar/privado/tramite', {
        fetch: fetchFalso,
        robotsCache: new Map(),
        intervaloHostMs: 0,
        reintentos: 0,
      }),
    ).rejects.toThrow(/robots\.txt/i);
    expect(pedidosDePagina).toBe(0);
  });

  it('reutiliza la caché en disco y no vuelve a pedir la página', async () => {
    const dirCache = await dirTemporal();
    let llamadas = 0;
    const fetchFalso = falso((url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      llamadas += 1;
      return new Response('<html><head><title>Trámite</title></head><body>DNI</body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    const opciones = {
      fetch: fetchFalso,
      dirCache,
      robotsCache: new Map<string, string | null>(),
      intervaloHostMs: 0,
      reintentos: 0,
    };

    const primera = await descargar('https://www.argentina.gob.ar/tramites/dni', opciones);
    expect(primera.tipo).toBe('html');
    expect(primera.desde_cache).toBe(false);
    expect(llamadas).toBe(1);

    const fetchQueFalla = falso(() => {
      throw new Error('no debería pedirse');
    });
    const segunda = await descargar('https://www.argentina.gob.ar/tramites/dni', {
      ...opciones,
      fetch: fetchQueFalla,
    });
    expect(segunda.desde_cache).toBe(true);
    expect(segunda.cuerpo).toContain('DNI');
    expect(llamadas).toBe(1);
  });

  it('usa el renderizador y guarda el resultado en una clave de caché distinta', async () => {
    const dirCache = await dirTemporal();
    let pedidosCrudos = 0;
    let renderizadas = 0;
    const fetchFalso = falso((url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      pedidosCrudos += 1;
      return new Response('<html><body>HTML crudo</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    });
    const renderizador = async (url: string) => {
      renderizadas += 1;
      return { html: '<html><body>HTML renderizado</body></html>', url_final: url };
    };
    const opciones = {
      fetch: fetchFalso,
      dirCache,
      robotsCache: new Map<string, string | null>(),
      intervaloHostMs: 0,
      reintentos: 0,
      renderizador,
    };
    const url = 'https://www.argentina.gob.ar/tramites/dni';

    const conRender = await descargar(url, { ...opciones, renderizar: true });
    expect(conRender.cuerpo).toContain('HTML renderizado');
    expect(conRender.url_final).toBe(url);
    expect(renderizadas).toBe(1);

    const cruda = await descargar(url, opciones);
    expect(cruda.cuerpo).toContain('HTML crudo');
    expect(cruda.desde_cache).toBe(false);
    expect(pedidosCrudos).toBe(1);

    const cacheada = await descargar(url, { ...opciones, renderizar: true });
    expect(cacheada.desde_cache).toBe(true);
    expect(cacheada.cuerpo).toContain('HTML renderizado');
    expect(renderizadas).toBe(1);
    expect(pedidosCrudos).toBe(1);
  });

  it('respeta robots.txt también cuando renderiza, sin llamar al navegador', async () => {
    let renderizadas = 0;
    const fetchFalso = falso((url) => {
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /privado\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response('ok', { headers: { 'content-type': 'text/html' } });
    });

    await expect(
      descargar('https://www.argentina.gob.ar/privado/tramite', {
        fetch: fetchFalso,
        renderizar: true,
        renderizador: async (url: string) => {
          renderizadas += 1;
          return { html: '', url_final: url };
        },
        robotsCache: new Map<string, string | null>(),
        intervaloHostMs: 0,
        reintentos: 0,
      }),
    ).rejects.toThrow(/robots\.txt/i);
    expect(renderizadas).toBe(0);
  });
});
