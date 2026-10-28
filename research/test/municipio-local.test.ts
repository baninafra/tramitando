import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Descarga } from '../src/descargar';
import { candidatos, clasificadorPorIndices, pasoMunicipioLocal } from '../src/pasos/municipio-local';
import { rutaDatos } from '../src/rutas';

const jurisdiccion = 'muni-prueba-sitio';
const catalogoPrueba = rutaDatos('catalogo', `${jurisdiccion}.json`);
afterEach(() => rmSync(catalogoPrueba, { force: true }));

const opciones = { jurisdiccion, nombre: 'Municipalidad de Prueba', provincia: 'Buenos Aires', preguntar: (async () => ({})) as never };

describe('municipio-local', () => {
  it('con --sitio no adivina direcciones y rechaza un sitio que no es oficial', async () => {
    const descargar = async (): Promise<Descarga> => {
      throw new Error('no debería descargar nada');
    };
    await expect(pasoMunicipioLocal({ ...opciones, sitio: 'https://ejemplo.com/', descargar })).rejects.toThrow(/no es oficial/);
  });

  it('con --sitio oficial recorre solo ese sitio', async () => {
    const pedidos: string[] = [];
    const cuerpo = `<html><head><title>Inicio</title></head><body>${Array.from({ length: 6 }, (_, i) => `<a href="/p${i}">Página ${i}</a>`).join('')}</body></html>`;
    const descargar = async (url: string): Promise<Descarga> => {
      pedidos.push(url);
      return { url, url_final: url, status: 200, content_type: 'text/html', fecha: '', cuerpo, tipo: 'html', desde_cache: false };
    };
    const nuevas = await pasoMunicipioLocal({
      ...opciones,
      sitio: 'https://prueba.gob.ar/',
      descargar,
      clasificar: (async () => ({ fichas: [], listado: [] })) as never,
    });
    expect(nuevas).toBe(0);
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every((u) => u.startsWith('https://prueba.gob.ar/'))).toBe(true);
  });

  it('arma direcciones oficiales típicas sin tildes ni espacios', () => {
    const c = candidatos('Municipalidad de San Carlos de Bariloche', 'Río Negro');
    expect(c[0]).toBe('https://www.sancarlosdebariloche.gob.ar/');
    expect(c).toContain('https://sancarlosdebariloche.rionegro.gob.ar/');
    expect(c.every((u) => /\.(gob|gov)\.ar\/$/.test(u))).toBe(true);
  });

  it('traduce los números que responde el modelo a URLs de la página', async () => {
    const clasificar = clasificadorPorIndices(async () => ({ fichas: [2, 2, 9], listado: [1] }) as never);
    const r = await clasificar(
      [
        { url: 'https://x.gob.ar/tramites', texto: 'Trámites' },
        { url: 'https://x.gob.ar/tramites/licencia', texto: 'Licencia de conducir' },
      ],
      { jurisdiccion_id: 'muni-1', nombre: 'X', guia_url: 'https://x.gob.ar/', listado_urls: [], regex_fichas: null },
    );
    expect(r).toEqual({ fichas: ['https://x.gob.ar/tramites/licencia'], listado: ['https://x.gob.ar/tramites'] });
  });
});

describe('municipio-local sin sitio', () => {
  it('no descarga los candidatos cuyo host no resuelve por DNS', async () => {
    const pedidos: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      pedidos.push(url);
      throw new Error('no existe');
    };
    const nuevas = await pasoMunicipioLocal({ ...opciones, descargar, resuelve: async (h) => h === 'prueba.gob.ar' });
    expect(nuevas).toBe(0);
    expect(pedidos).toEqual(['https://prueba.gob.ar/']);
  });
});

describe('municipio-local con sitio de fuente oficial', () => {
  it('prueba primero el sitio conocido y lo acepta aunque no lleve el nombre', async () => {
    const pedidos: string[] = [];
    const cuerpo = `<html><head><title>Inicio</title></head><body>${Array.from({ length: 6 }, (_, i) => `<a href="/p${i}">Página ${i}</a>`).join('')}</body></html>`;
    const descargar = async (url: string): Promise<Descarga> => {
      pedidos.push(url);
      return { url, url_final: url, status: 200, content_type: 'text/html', fecha: '', cuerpo, tipo: 'html', desde_cache: false };
    };
    await pasoMunicipioLocal({
      ...opciones,
      sitioConocido: 'https://mpr.gob.ar/',
      descargar,
      clasificar: (async () => ({ fichas: [], listado: [] })) as never,
    });
    expect(pedidos[0]).toBe('https://mpr.gob.ar/');
    expect(pedidos.every((u) => u.startsWith('https://mpr.gob.ar/'))).toBe(true);
  });

  it('ignora un sitio conocido que no es .gob.ar/.gov.ar', async () => {
    const pedidos: string[] = [];
    const descargar = async (url: string): Promise<Descarga> => {
      pedidos.push(url);
      throw new Error('no existe');
    };
    await pasoMunicipioLocal({ ...opciones, sitioConocido: 'https://prueba.com.ar/', descargar });
    expect(pedidos).not.toContain('https://prueba.com.ar/');
  });
});
