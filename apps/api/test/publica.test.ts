import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { cargarFixtures } from './fixtures/publica';

const BASE = 'https://api.test';
const CACHE = 'public, max-age=300, s-maxage=3600';

interface RespuestaError {
  error: { codigo: string; mensaje: string };
}

interface RespuestaTemas {
  temas: { slug: string; cantidad_tramites: number; subtemas: { slug: string }[] }[];
  situaciones: { slug: string }[];
}

interface ElementoTema {
  slug: string;
  variante: { jurisdiccion: { slug: string } } | null;
}

interface RespuestaTema {
  tema: { slug: string; padre: { slug: string } | null };
  subtemas: { slug: string }[];
  tramites: ElementoTema[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
}

interface RespuestaTramite {
  tramite: { slug: string };
  temas: { slug: string; principal: boolean }[];
  jurisdicciones: { jurisdiccion: { nivel: string; slug: string } }[];
}

interface RespuestaFicha {
  tramite: { slug: string };
  variante: {
    jurisdiccion: { nivel: string; slug: string };
    contenido: { requisitos: unknown[]; requiere_turno: boolean | null };
    costos: { gratis: boolean; monto_centavos: number | null; monto_texto: string }[];
    fuentes: Record<string, { url: string }[]>;
    oficinas: { nombre: string }[];
  };
  heredada_de: string | null;
  indexable: boolean;
}

interface RespuestaBusqueda {
  resultados: ElementoTema[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
}

interface RespuestaJurisdicciones {
  jurisdicciones: { slug: string; nivel: string }[];
}

interface RespuestaOrganismo {
  organismo: { slug: string; jurisdiccion: { slug: string } };
  tramites: { slug: string }[];
  oficinas: { nombre: string }[];
}

interface RespuestaSitemap {
  urls: { url: string; actualizado_en: string; tipo: string }[];
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function get(ruta: string): Promise<Response> {
  return SELF.fetch(`${BASE}${ruta}`);
}

beforeAll(async () => {
  await cargarFixtures(env.DB);
});

describe('GET /v1/temas', () => {
  it('devuelve temas activos con sus subtemas, situaciones y cantidades', async () => {
    const res = await get('/v1/temas');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaTemas>(res);
    expect(datos.temas.map((tema) => tema.slug)).toEqual(['documentos', 'transito', 'turnos', 'sin-portada']);
    expect(datos.situaciones.map((situacion) => situacion.slug)).toEqual(['nacio-mi-hijo']);

    const documentos = datos.temas.find((tema) => tema.slug === 'documentos');
    expect(documentos?.subtemas.map((tema) => tema.slug)).toEqual(['identidad']);
    // DNI (en el subtema) y partida; quedan afuera el trámite archivado y el que no tiene variantes.
    expect(documentos?.cantidad_tramites).toBe(2);
  });

  it('con portada=1 filtra los temas de portada', async () => {
    const res = await get('/v1/temas?portada=1');
    const datos = await json<RespuestaTemas>(res);
    expect(datos.temas.map((tema) => tema.slug)).toEqual(['documentos', 'transito']);
  });

  it('rechaza portada con valor inválido', async () => {
    const res = await get('/v1/temas?portada=2');
    expect(res.status).toBe(400);
    const datos = await json<RespuestaError>(res);
    expect(datos.error.codigo).toBe('parametros_invalidos');
  });
});

describe('GET /v1/temas/:slug', () => {
  it('devuelve el tema, sus subtemas y sus trámites', async () => {
    const res = await get('/v1/temas/documentos');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaTema>(res);
    expect(datos.tema.slug).toBe('documentos');
    expect(datos.tema.padre).toBeNull();
    expect(datos.subtemas.map((tema) => tema.slug)).toContain('identidad');
    expect(datos.tramites.map((tramite) => tramite.slug).sort()).toEqual(['partida-de-nacimiento', 'renovar-dni']);
    expect(datos.total).toBe(2);
    expect(datos.pagina).toBe(1);
    expect(datos.por_pagina).toBe(24);
    expect(datos.paginas).toBe(1);
  });

  it('pagina de a 24', async () => {
    const primera = await json<RespuestaTema>(await get('/v1/temas/turnos'));
    expect(primera.total).toBe(26);
    expect(primera.tramites).toHaveLength(24);
    expect(primera.paginas).toBe(2);

    const segunda = await json<RespuestaTema>(await get('/v1/temas/turnos?pagina=2'));
    expect(segunda.pagina).toBe(2);
    expect(segunda.tramites).toHaveLength(2);
    const slugsPrimera = new Set(primera.tramites.map((tramite) => tramite.slug));
    expect(segunda.tramites.every((tramite) => !slugsPrimera.has(tramite.slug))).toBe(true);
  });

  it('con ubicación prioriza y muestra la variante de esa jurisdicción', async () => {
    const datos = await json<RespuestaTema>(await get('/v1/temas/licencias?prov=santa-fe&muni=rosario'));
    expect(datos.tramites.map((tramite) => tramite.slug)).toEqual(['licencia-de-conducir']);
    expect(datos.tramites[0]?.variante?.jurisdiccion.slug).toBe('rosario');
  });

  it('redirige un slug viejo de tema', async () => {
    const res = await get('/v1/temas/documentos-viejo');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);
    expect(await json<{ redirect: string }>(res)).toEqual({ redirect: 'documentos' });
  });

  it('devuelve 404 si el tema no existe', async () => {
    const res = await get('/v1/temas/no-existe');
    expect(res.status).toBe(404);
    expect((await json<RespuestaError>(res)).error.codigo).toBe('tema_no_encontrado');
  });

  it('devuelve 404 si la ubicación pedida no existe', async () => {
    const res = await get('/v1/temas/documentos?prov=no-existe');
    expect(res.status).toBe(404);
    expect((await json<RespuestaError>(res)).error.codigo).toBe('ubicacion_no_encontrada');
  });
});

describe('GET /v1/tramites/:slug', () => {
  it('devuelve el trámite, sus temas y las jurisdicciones con ficha', async () => {
    const res = await get('/v1/tramites/renovar-dni');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaTramite>(res);
    expect(datos.tramite.slug).toBe('renovar-dni');
    expect(datos.temas[0]).toMatchObject({ slug: 'identidad', principal: true });
    expect(datos.jurisdicciones.map((item) => item.jurisdiccion.nivel)).toEqual(['nacion', 'provincia']);
    expect(datos.jurisdicciones.map((item) => item.jurisdiccion.slug)).toEqual(['nacion', 'santa-fe']);
  });

  it('devuelve una lista vacía si todavía no tiene variantes', async () => {
    const datos = await json<RespuestaTramite>(await get('/v1/tramites/tramite-sin-variantes'));
    expect(datos.jurisdicciones).toEqual([]);
  });

  it('no muestra trámites archivados', async () => {
    const res = await get('/v1/tramites/tramite-archivado');
    expect(res.status).toBe(404);
  });

  it('redirige un slug viejo de trámite', async () => {
    const res = await get('/v1/tramites/dni-viejo');
    expect(await json<{ redirect: string }>(res)).toEqual({ redirect: 'renovar-dni' });
  });
});

describe('GET /v1/fichas/:tramite', () => {
  it('devuelve la ficha exacta del municipio con costos, fuentes y oficinas', async () => {
    const res = await get('/v1/fichas/licencia-de-conducir?prov=santa-fe&muni=rosario');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaFicha>(res);
    expect(datos.tramite.slug).toBe('licencia-de-conducir');
    expect(datos.variante.jurisdiccion).toMatchObject({ nivel: 'municipio', slug: 'rosario' });
    expect(datos.heredada_de).toBeNull();
    expect(datos.indexable).toBe(true);

    expect(datos.variante.contenido.requisitos).toHaveLength(1);
    expect(datos.variante.costos).toHaveLength(1);
    expect(datos.variante.costos[0]).toMatchObject({ gratis: false, monto_centavos: 9500000, monto_texto: '$ 95.000' });
    expect(datos.variante.fuentes.costo?.[0]?.url).toBe('https://www.rosario.gob.ar/movilidad');
    expect(datos.variante.oficinas.map((oficina) => oficina.nombre)).toEqual(['Centro Municipal de Licencias']);
  });

  it('hereda de la provincia cuando el municipio no tiene ficha propia', async () => {
    const datos = await json<RespuestaFicha>(await get('/v1/fichas/renovar-dni?prov=santa-fe&muni=rafaela'));
    expect(datos.variante.jurisdiccion).toMatchObject({ nivel: 'provincia', slug: 'santa-fe' });
    expect(datos.heredada_de).toBe('provincia');
    expect(datos.indexable).toBe(false);
    expect(datos.variante.costos[0]).toMatchObject({ gratis: true, monto_centavos: null, monto_texto: 'Gratis' });
  });

  it('hereda de Nación cuando la provincia no tiene ficha propia', async () => {
    const datos = await json<RespuestaFicha>(await get('/v1/fichas/renovar-dni?prov=cordoba'));
    expect(datos.variante.jurisdiccion).toMatchObject({ nivel: 'nacion', slug: 'nacion' });
    expect(datos.heredada_de).toBe('nacion');
    expect(datos.indexable).toBe(false);
  });

  it('sin ubicación usa Nación y formatea los montos con separador de miles', async () => {
    const datos = await json<RespuestaFicha>(await get('/v1/fichas/renovar-dni'));
    expect(datos.variante.jurisdiccion.slug).toBe('nacion');
    expect(datos.heredada_de).toBeNull();
    expect(datos.indexable).toBe(true);

    expect(datos.variante.costos.map((costo) => costo.monto_texto)).toEqual(['$ 12.500', '$ 25.000,50']);
    // Solo las oficinas del organismo en la jurisdicción de la variante.
    expect(datos.variante.oficinas.map((oficina) => oficina.nombre)).toEqual(['Sede central RENAPER']);
    expect(datos.variante.fuentes.requisitos?.[0]?.url).toBe('https://www.argentina.gob.ar/interior/renaper');
    expect(datos.variante.fuentes.plazo).toEqual([]);
  });

  it('devuelve 404 si no hay ninguna variante publicada', async () => {
    const res = await get('/v1/fichas/tramite-sin-variantes');
    expect(res.status).toBe(404);
    expect((await json<RespuestaError>(res)).error.codigo).toBe('ficha_no_encontrada');
  });

  it('devuelve 404 si la ubicación no existe', async () => {
    const res = await get('/v1/fichas/renovar-dni?prov=no-existe');
    expect(res.status).toBe(404);
    expect((await json<RespuestaError>(res)).error.codigo).toBe('ubicacion_no_encontrada');
  });
});

describe('GET /v1/buscar', () => {
  it('encuentra por prefijo', async () => {
    const res = await get('/v1/buscar?q=licen');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaBusqueda>(res);
    expect(datos.total).toBe(1);
    expect(datos.resultados.map((item) => item.slug)).toEqual(['licencia-de-conducir']);
  });

  it('encuentra sin tildes', async () => {
    const datos = await json<RespuestaBusqueda>(await get('/v1/buscar?q=renovacion'));
    expect(datos.resultados.map((item) => item.slug)).toContain('renovar-dni');
  });

  it('tolera intentos de inyección de sintaxis FTS', async () => {
    const res = await get(`/v1/buscar?q=${encodeURIComponent('licencia" NEAR( *')}`);
    expect(res.status).toBe(200);
    const datos = await json<RespuestaBusqueda>(res);
    expect(datos.resultados.map((item) => item.slug)).toContain('licencia-de-conducir');
  });

  it('rechaza texto vacío o solo símbolos', async () => {
    for (const consulta of ['', '%20%20', '%22%2A%22']) {
      const res = await get(`/v1/buscar?q=${consulta}`);
      expect(res.status).toBe(400);
      expect((await json<RespuestaError>(res)).error.codigo).toBe('parametros_invalidos');
    }
  });

  it('pagina de a 24 y devuelve el total', async () => {
    const primera = await json<RespuestaBusqueda>(await get('/v1/buscar?q=turno'));
    expect(primera.total).toBe(26);
    expect(primera.resultados).toHaveLength(24);
    expect(primera.paginas).toBe(2);

    const segunda = await json<RespuestaBusqueda>(await get('/v1/buscar?q=turno&pagina=2'));
    expect(segunda.resultados).toHaveLength(2);
    expect(segunda.pagina).toBe(2);
  });

  it('prioriza los trámites con variante en la ubicación pedida', async () => {
    const datos = await json<RespuestaBusqueda>(await get('/v1/buscar?q=sacar&prov=santa-fe&muni=rosario'));
    expect(datos.resultados[0]?.slug).toBe('licencia-de-conducir');
    expect(datos.resultados[0]?.variante?.jurisdiccion.slug).toBe('rosario');
  });

  it('no muestra trámites archivados', async () => {
    const datos = await json<RespuestaBusqueda>(await get('/v1/buscar?q=archivado'));
    expect(datos.resultados).toEqual([]);
    expect(datos.total).toBe(0);
  });
});

describe('GET /v1/jurisdicciones', () => {
  it('lista provincias ordenadas por nombre', async () => {
    const datos = await json<RespuestaJurisdicciones>(await get('/v1/jurisdicciones?nivel=provincia'));
    expect(datos.jurisdicciones.map((j) => j.slug)).toEqual(['cordoba', 'santa-fe']);
  });

  it('lista los municipios de una provincia', async () => {
    const datos = await json<RespuestaJurisdicciones>(await get('/v1/jurisdicciones?nivel=municipio&padre=santa-fe'));
    expect(datos.jurisdicciones.map((j) => j.slug)).toEqual(['rafaela', 'rosario']);
    expect(datos.jurisdicciones.every((j) => j.nivel === 'municipio')).toBe(true);
  });

  it('rechaza un nivel inválido', async () => {
    const res = await get('/v1/jurisdicciones?nivel=barrio');
    expect(res.status).toBe(400);
    expect((await json<RespuestaError>(res)).error.codigo).toBe('parametros_invalidos');
  });
});

describe('GET /v1/organismos/:slug', () => {
  it('devuelve el organismo, sus trámites y sus oficinas', async () => {
    const res = await get('/v1/organismos/renaper');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaOrganismo>(res);
    expect(datos.organismo.slug).toBe('renaper');
    expect(datos.organismo.jurisdiccion.slug).toBe('nacion');
    expect(datos.tramites.map((tramite) => tramite.slug)).toContain('renovar-dni');
    expect(datos.oficinas.map((oficina) => oficina.nombre).sort()).toEqual(['Delegación RENAPER Santa Fe', 'Sede central RENAPER']);
  });

  it('devuelve 404 si el organismo no existe', async () => {
    const res = await get('/v1/organismos/no-existe');
    expect(res.status).toBe(404);
    expect((await json<RespuestaError>(res)).error.codigo).toBe('organismo_no_encontrado');
  });
});

describe('GET /v1/sitemap', () => {
  it('lista las URLs de fichas propias y los índices de trámite', async () => {
    const res = await get('/v1/sitemap');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(CACHE);

    const datos = await json<RespuestaSitemap>(res);
    const urls = datos.urls.map((item) => item.url);
    expect(urls).toContain('/tramites/renovar-dni');
    expect(urls).toContain('/tramites/renovar-dni/santa-fe');
    expect(urls).toContain('/tramites/licencia-de-conducir/santa-fe/rosario');
    expect(urls).toContain('/tramites/turno-1');
    expect(urls.filter((url) => url === '/tramites/renovar-dni')).toHaveLength(1);
    expect(datos.urls.every((item) => item.actualizado_en && item.tipo)).toBe(true);
  });
});
