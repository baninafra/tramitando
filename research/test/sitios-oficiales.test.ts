import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dominioDe, normalizarSitio, parsearGba, parsearRefeglo, pasoSitiosOficiales, pasoVerificarDominios, URL_GBA } from '../src/pasos/sitios-oficiales';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csv = [
  'cod_gobierno_local;provincia;gobierno_local;sitio_web;telefonos',
  '60007;Buenos Aires;Adolfo Alsina;www.adolfoalsina.gov.ar;123',
  '60021;Buenos Aires;Alberti;www.viejo-alberti.gov.ar;123',
  '140014;Córdoba;Algo;-;123',
  '140021;Córdoba;Otro;http://www.otro.com.ar/ ;123',
].join('\r\n');
const gba = `<div><h4>Municipalidad de</h4><h3 class="nuevafuente">Alberti</h3><p>Intendente: X</p>
<a href="http://alberti.gov.ar/" target="_blank">www.alberti.gov.ar</a></div>`;

describe('sitios oficiales', () => {
  it('normaliza direcciones y descarta lo que no es web', () => {
    expect(normalizarSitio('www.x.gob.ar')).toBe('https://www.x.gob.ar/');
    expect(normalizarSitio('http://X.gob.ar/mcd ')).toBe('http://x.gob.ar/mcd');
    expect(normalizarSitio('-')).toBeNull();
    expect(normalizarSitio('s/d')).toBeNull();
  });

  it('lee ReFeGLo con el mismo id que usamos y gba por nombre', () => {
    const r = parsearRefeglo(csv);
    expect(r.get('muni-060007')).toBe('https://www.adolfoalsina.gov.ar/');
    expect(r.has('muni-140014')).toBe(false);
    expect(parsearGba(gba).get('alberti')).toBe('http://alberti.gov.ar/');
  });

  it('gba manda sobre ReFeGLo en Buenos Aires', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sitios-'));
    const tsv = join(dir, 'municipios.tsv');
    writeFileSync(tsv, 'muni-060007\tMunicipalidad de Adolfo Alsina\tmunicipio\tBuenos Aires\nmuni-060021\tMunicipalidad de Alberti\tmunicipio\tBuenos Aires\nmuni-140021\tMunicipalidad de Otro\tmunicipio\tCórdoba\n');
    const destino = join(dir, 'sitios.tsv');
    const n = await pasoSitiosOficiales({
      municipiosTsv: tsv,
      destino,
      bajar: async (url) => new TextEncoder().encode(url === URL_GBA ? gba : csv),
    });
    expect(n).toBe(3);
    expect(readFileSync(destino, 'utf8').trim().split('\n')).toEqual([
      'muni-060007\thttps://www.adolfoalsina.gov.ar/\trefeglo',
      'muni-060021\thttp://alberti.gov.ar/\tgba',
      'muni-140021\thttp://www.otro.com.ar/\trefeglo',
    ]);
  });
});

describe('verificar dominios', () => {
  const pagina = (titulo: string) =>
    `<html><head><title>${titulo}</title></head><body>${Array.from({ length: 6 }, (_, i) => `<a href="/p${i}">Página ${i}</a>`).join('')}</body></html>`;

  it('acepta el .com que nombra al municipio y rechaza el vencido, las plataformas y los .gob', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dominios-'));
    writeFileSync(join(dir, 'sitios.tsv'), [
      'muni-1\thttps://www.lasflores.com.ar/\trefeglo',
      'muni-2\thttps://vencido.com/\trefeglo',
      'muni-3\thttps://www.facebook.com/muni3\trefeglo',
      'muni-4\thttps://cuatro.gob.ar/\trefeglo',
    ].join('\n'));
    writeFileSync(join(dir, 'municipios.tsv'), [
      'muni-1\tMunicipalidad de Las Flores\tmunicipio\tBuenos Aires',
      'muni-2\tMunicipalidad de Otra\tmunicipio\tCórdoba',
      'muni-3\tMunicipalidad de Tres\tmunicipio\tCórdoba',
      'muni-4\tMunicipalidad de Cuatro\tmunicipio\tCórdoba',
    ].join('\n'));
    const pedidos: string[] = [];
    const n = await pasoVerificarDominios({
      sitiosTsv: join(dir, 'sitios.tsv'),
      municipiosTsv: join(dir, 'municipios.tsv'),
      destino: join(dir, 'dominios.ts'),
      permitir: () => {},
      descargar: async (url) => {
        pedidos.push(url);
        const titulo = url.includes('lasflores') ? 'Municipalidad de Las Flores' : 'Dominio en venta';
        return { tipo: 'html', status: 200, cuerpo: pagina(titulo), url_final: url };
      },
    });
    expect(n).toBe(1);
    expect(pedidos.sort()).toEqual(['https://vencido.com/', 'https://www.lasflores.com.ar/']);
    expect(readFileSync(join(dir, 'dominios.ts'), 'utf8')).toContain('"lasflores.com.ar": "Municipalidad de Las Flores (Buenos Aires): sitio según ReFeGLo');
  });

  it('nunca acepta una plataforma compartida entera', () => {
    expect(dominioDe('https://sites.google.com/view/x')).toBeNull();
    expect(dominioDe('https://muni.wixsite.com/x')).toBeNull();
    expect(dominioDe('https://www.muni.com.ar/')).toBe('muni.com.ar');
  });
});
