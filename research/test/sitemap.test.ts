import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { descargar, type Descarga } from '../src/descargar.js';
import { fichasDesdeSitemaps } from '../src/sitemap.js';

const HOST = 'www.portaltest.gob.ar';
const BASE = `https://${HOST}`;
const REGEX = /^https:\/\/www\.portaltest\.gob\.ar\/servicio\/[a-z0-9-]+$/;

function respuesta(
  url: string,
  cuerpo: string,
  opciones: { status?: number; tipo?: Descarga['tipo']; contentType?: string } = {},
): Descarga {
  return {
    url,
    url_final: url,
    status: opciones.status ?? 200,
    content_type: opciones.contentType ?? 'application/xml',
    fecha: '2026-10-22T00:00:00.000Z',
    cuerpo,
    tipo: opciones.tipo ?? 'texto',
    desde_cache: false,
  };
}

describe('fichasDesdeSitemaps', () => {
  it('recorre un sitemap index con dos hijos (uno gzip) y junta solo lo que matchea', async () => {
    const paginas = new Map<string, Descarga>([
      [
        `${BASE}/robots.txt`,
        respuesta(`${BASE}/robots.txt`, `User-agent: *\nSitemap: ${BASE}/sitemap-index.xml\n`, {
          contentType: 'text/plain',
        }),
      ],
      [
        `${BASE}/sitemap-index.xml`,
        respuesta(
          `${BASE}/sitemap-index.xml`,
          `<sitemapindex>
            <sitemap><loc>${BASE}/sitemap-a.xml</loc></sitemap>
            <sitemap><loc>${BASE}/sitemap-b.xml.gz</loc></sitemap>
          </sitemapindex>`,
        ),
      ],
      [
        `${BASE}/sitemap-a.xml`,
        respuesta(
          `${BASE}/sitemap-a.xml`,
          `<urlset>
            <url><loc>${BASE}/servicio/documento-nacional</loc></url>
            <url><loc>${BASE}/otros/consulta</loc></url>
          </urlset>`,
        ),
      ],
      [
        `${BASE}/sitemap-b.xml.gz`,
        respuesta(
          `${BASE}/sitemap-b.xml.gz`,
          `<urlset>
            <url><loc>${BASE}/servicio/pasaporte</loc></url>
            <url><loc>${BASE}/servicio/Mayusculas</loc></url>
            <url><loc>${BASE}/tema/documentacion</loc></url>
          </urlset>`,
        ),
      ],
    ]);

    const descargarFalso = async (url: string): Promise<Descarga> => {
      const pagina = paginas.get(url);
      if (!pagina) throw new Error(`sitemap inesperado: ${url}`);
      return pagina;
    };

    const fichas = await fichasDesdeSitemaps({ descargar: descargarFalso, host: HOST, regex: REGEX });

    expect(fichas.map((ficha) => ficha.url).sort()).toEqual([
      `${BASE}/servicio/documento-nacional`,
      `${BASE}/servicio/pasaporte`,
    ]);
    expect(fichas.find((ficha) => ficha.url.endsWith('/documento-nacional'))?.nombre_oficial).toBe(
      'documento nacional',
    );
  });

  it('descomprime los .xml.gz que bajan como binario', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset><url><loc>${BASE}/servicio/pasaporte</loc></url></urlset>`;
    const fetchFalso = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.endsWith('/sitemap.xml.gz')) {
        return new Response(gzipSync(Buffer.from(xml)), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const dirCache = await mkdtemp(join(tmpdir(), 'tramitando-sitemap-'));
    try {
      const descarga = await descargar(`${BASE}/sitemap.xml.gz`, {
        fetch: fetchFalso,
        dirCache,
        robotsCache: new Map<string, string | null>(),
        intervaloHostMs: 0,
        reintentos: 0,
      });
      expect(descarga.tipo).toBe('texto');
      expect(descarga.cuerpo).toContain(`${BASE}/servicio/pasaporte`);
    } finally {
      await rm(dirCache, { recursive: true, force: true });
    }
  });

  it('usa /sitemap.xml cuando robots no declara Sitemap y devuelve vacío si da 404', async () => {
    const visitadas: string[] = [];
    const descargarFalso = async (url: string): Promise<Descarga> => {
      visitadas.push(url);
      if (url.endsWith('/robots.txt')) {
        return respuesta(url, 'User-agent: *\nDisallow: /privado\n', {
          contentType: 'text/plain',
        });
      }
      return respuesta(url, '', { status: 404 });
    };

    const fichas = await fichasDesdeSitemaps({ descargar: descargarFalso, host: HOST, regex: REGEX });

    expect(visitadas).toContain(`${BASE}/sitemap.xml`);
    expect(fichas).toEqual([]);
  });
});
