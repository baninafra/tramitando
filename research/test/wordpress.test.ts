import { readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Descarga } from '../src/descargar';
import { pasoMunicipioLocal } from '../src/pasos/municipio-local';
import { clasificarPorReglas } from '../src/reglas';
import { rutaDatos } from '../src/rutas';
import { MAX_AREAS, textoDeTitulo, tramitesDeWordPress } from '../src/wordpress';

const respuesta = (url: string, cuerpo: string, status = 200): Descarga => ({
  url, url_final: url, status, content_type: 'application/json', fecha: '', cuerpo, tipo: 'json', desde_cache: false,
});
const pagina = (slug: string, titulo: string) => ({ link: `https://www.muni.gob.ar/${slug}/`, title: { rendered: titulo } });
const portal = { jurisdiccion_id: 'muni-wp', nombre: 'Muni', guia_url: 'https://muni.gob.ar/', listado_urls: [], regex_fichas: null };
// Solo reglas: lo dudoso queda afuera (en la CLI lo resuelve el 2B).
const porReglas = async (links: { url: string; texto: string }[], p: typeof portal) => ({
  fichas: links.filter((l) => clasificarPorReglas(l, new URL(p.guia_url).hostname) === 'ficha').map((l) => l.url),
  listado: [],
});

describe('atajo de WordPress', () => {
  it('decodifica los títulos que manda WordPress', () => {
    expect(textoDeTitulo('Licencias &#8211; Renovaci&oacute;n <b>2026</b>')).toBe('Licencias – Renovación 2026');
  });

  it('lista páginas de a 100, suma el tipo propio de trámites y clasifica los títulos', async () => {
    const pedidos: string[] = [];
    const primeras = Array.from({ length: 100 }, (_, i) => pagina(`p${i}`, `Página ${i}`));
    const descargar = async (url: string) => {
      pedidos.push(url);
      if (url.includes('/pages?') && url.includes('page=1&')) return respuesta(url, JSON.stringify([...primeras.slice(0, 98), pagina('licencia-de-conducir', 'Licencia de conducir'), pagina('noticias', 'Noticias')]));
      if (url.includes('/pages?') && url.includes('page=2&')) return respuesta(url, JSON.stringify([pagina('habilitacion-comercial', 'Habilitaci&oacute;n comercial')]));
      if (url.endsWith('/types')) return respuesta(url, JSON.stringify({ page: { slug: 'page', rest_base: 'pages' }, tramite: { slug: 'tramite', rest_base: 'tramites' } }));
      if (url.includes('/tramites?')) return respuesta(url, JSON.stringify([pagina('tramites/libre-deuda', 'Libre deuda')]));
      return respuesta(url, 'no', 404);
    };
    const r = await tramitesDeWordPress('https://muni.gob.ar/', { descargar });
    expect(r?.titulos).toBe(102);
    expect(r?.fichas.map((f) => f.nombre_oficial).sort()).toEqual(['Habilitación comercial', 'Libre deuda', 'Licencia de conducir']);
    expect(pedidos.filter((u) => u.includes('/pages?'))).toHaveLength(2);
  });

  it('suma las entradas de la categoría Trámites pero no las noticias', async () => {
    const pedidos: string[] = [];
    const descargar = async (url: string) => {
      pedidos.push(url);
      if (url.includes('/pages?')) return respuesta(url, JSON.stringify([pagina('inicio', 'Inicio')]));
      if (url.includes('/categories?')) return respuesta(url, JSON.stringify([{ id: 3, slug: 'noticias', name: 'Noticias' }, { id: 7, slug: 'tramites', name: 'Tr&aacute;mites' }]));
      if (url.includes('/posts?categories=7&')) return respuesta(url, JSON.stringify([pagina('cambio-de-titularidad-del-inmueble', 'Licencia comercial: cambio de titularidad'), pagina('poda-de-arboles', 'Poda de árboles en la vereda'), pagina('tramites', 'Trámites')]));
      return respuesta(url, 'no', 404);
    };
    const r = await tramitesDeWordPress('https://muni.gob.ar/', { descargar });
    // Lo que el sitio catalogó como trámite entra aunque las reglas no lo reconozcan; la página índice no.
    expect(r?.fichas.map((x) => x.nombre_oficial)).toEqual(['Licencia comercial: cambio de titularidad', 'Poda de árboles en la vereda']);
    expect(pedidos.some((u) => u.includes('categories=3'))).toBe(false);
  });

  it('devuelve null si el sitio no es WordPress', async () => {
    const descargar = async (url: string) => ({ ...respuesta(url, '<html></html>'), tipo: 'html' as const, content_type: 'text/html' });
    expect(await tramitesDeWordPress('https://muni.gob.ar/', { descargar })).toBeNull();
  });
});

describe('municipio-local con WordPress', () => {
  const destino = rutaDatos('catalogo', 'muni-wp.json');
  afterEach(() => rmSync(destino, { force: true }));

  const muchas = Array.from({ length: 12 }, (_, i) => pagina(`licencia-${i}`, `Licencia de conducir ${i}`));

  it('con 10 o más trámites usa la API sin recorrer y los guarda pendientes de clasificar', async () => {
    const pedidos: string[] = [];
    const descargar = async (url: string) => {
      pedidos.push(url);
      if (url.includes('/pages?')) return respuesta(url, JSON.stringify(muchas));
      return respuesta(url, 'no', 404);
    };
    const n = await pasoMunicipioLocal({
      jurisdiccion: 'muni-wp', nombre: 'Municipalidad de Muni', provincia: 'Córdoba', sitio: 'https://www.muni.gob.ar/',
      descargar, preguntar: (async () => ({})) as never, clasificar: porReglas as never,
    });
    expect(n).toBe(12);
    // Solo la API, la portada y a lo sumo MAX_AREAS páginas de área: no recorre.
    const otros = pedidos.filter((u) => !u.includes('/wp-json/'));
    expect(otros[0]).toBe('https://www.muni.gob.ar/');
    expect(otros.length).toBeLessThanOrEqual(1 + MAX_AREAS);
    const [e] = JSON.parse(readFileSync(destino, 'utf8'));
    expect(e).toMatchObject({ url: 'https://www.muni.gob.ar/licencia-0/', nombre_oficial: 'Licencia de conducir 0', portal: 'https://www.muni.gob.ar/' });
    expect('temas_sugeridos' in e).toBe(false);
  });

  it('con menos de 10 recorre el sitio igual y suma lo de los dos', async () => {
    const pedidos: string[] = [];
    const html = `<html><head><title>Muni</title></head><body>${['tramites/tasas', 'p1', 'p2', 'p3', 'p4'].map((p) => `<a href="/${p}">${p === 'tramites/tasas' ? 'Pago de tasas' : p}</a>`).join('')}</body></html>`;
    const descargar = async (url: string) => {
      pedidos.push(url);
      if (url.includes('/pages?')) return respuesta(url, JSON.stringify([pagina('licencia-de-conducir', 'Licencia de conducir')]));
      if (url.includes('/wp-json/')) return respuesta(url, 'no', 404);
      return { ...respuesta(url, html), tipo: 'html' as const, content_type: 'text/html' };
    };
    const n = await pasoMunicipioLocal({
      jurisdiccion: 'muni-wp', nombre: 'Municipalidad de Muni', provincia: 'Córdoba', sitio: 'https://www.muni.gob.ar/',
      descargar, preguntar: (async () => ({})) as never, clasificar: porReglas as never,
    });
    const urls = JSON.parse(readFileSync(destino, 'utf8')).map((e: { url: string }) => e.url).sort();
    expect(pedidos.some((u) => !u.includes('/wp-json/'))).toBe(true);
    expect(urls).toEqual(['https://www.muni.gob.ar/licencia-de-conducir/', 'https://www.muni.gob.ar/tramites/tasas']);
    expect(n).toBe(2);
  });

  it('con 10 o más pero una sección de la portada que la API no publica, recorre igual (caso Saldán)', async () => {
    const pedidos: string[] = [];
    const portada = `<html><head><title>Muni</title></head><body>${['tramites/cambio-domicilio', 'tramites/libre-deuda', 'p1', 'p2', 'p3'].map((p) => `<a href="/${p}">${p}</a>`).join('')}</body></html>`;
    const descargar = async (url: string) => {
      pedidos.push(url);
      if (url.includes('/pages?')) return respuesta(url, JSON.stringify(muchas));
      if (url.includes('/wp-json/')) return respuesta(url, 'no', 404);
      return { ...respuesta(url, portada), tipo: 'html' as const, content_type: 'text/html' };
    };
    await pasoMunicipioLocal({
      jurisdiccion: 'muni-wp', nombre: 'Municipalidad de Muni', provincia: 'Córdoba', sitio: 'https://www.muni.gob.ar/',
      descargar, preguntar: (async () => ({})) as never, clasificar: porReglas as never,
    });
    const urls = JSON.parse(readFileSync(destino, 'utf8')).map((e: { url: string }) => e.url);
    expect(urls).toContain('https://www.muni.gob.ar/tramites/cambio-domicilio');
    expect(urls).toContain('https://www.muni.gob.ar/licencia-0/');
  });
});

describe('secciones sin cubrir', () => {
  it('detecta las secciones de trámites que la API no publica', async () => {
    const { seccionesSinCubrir } = await import('../src/wordpress');
    const links = ['https://x.gob.ar/tramites/a', 'https://x.gob.ar/categoria/tramites/rentas/', 'https://x.gob.ar/servicios/', 'https://otro.gob.ar/tramites/z', 'https://x.gob.ar/noticias/n']
      .map((url) => ({ url, texto: '' }));
    expect(seccionesSinCubrir(links, 'www.x.gob.ar', ['https://x.gob.ar/tramites/a/', 'https://x.gob.ar/servicios/agua/']).sort()).toEqual(['/categoria/tramites/']);
  });
});

describe('trámites de páginas de área', () => {
  it('baja las páginas de área y suma los links que son trámite, sin repetir ni salir del sitio', async () => {
    const { tramitesDeAreas } = await import('../src/wordpress');
    const html = `<html><body>
      <a href="/registro-civil/partidas-de-nacimiento">Partidas de nacimiento</a>
      <a href="/licencia-ya-conocida">Licencia de conducir</a>
      <a href="https://otro.gob.ar/turnos">Turnos</a>
      <a href="/noticias/algo">Noticias</a></body></html>`;
    const pedidos: string[] = [];
    const descargar = async (url: string) => {
      pedidos.push(url);
      return { url, url_final: url, status: 200, content_type: 'text/html', fecha: '', cuerpo: html, tipo: 'html' as const, desde_cache: false };
    };
    const links = [
      { url: 'https://muni.gob.ar/registro-civil/', texto: 'Registro Civil' },
      { url: 'https://muni.gob.ar/historia/', texto: 'Nuestra historia' },
    ];
    const r = await tramitesDeAreas(links, new Set(['https://muni.gob.ar/licencia-ya-conocida']), descargar as never);
    expect(pedidos).toEqual(['https://muni.gob.ar/registro-civil/']);
    expect(r).toEqual([{ url: 'https://muni.gob.ar/registro-civil/partidas-de-nacimiento', nombre_oficial: 'Partidas de nacimiento' }]);
  });
});
