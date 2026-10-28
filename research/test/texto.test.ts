import { describe, expect, it } from 'vitest';
import { extraerTexto } from '../src/texto.js';

const HTML = `<!doctype html>
<html>
  <head><title>Trámite de DNI</title><style>.x { color: red }</style></head>
  <body>
    <header><a href="/inicio">Inicio</a><a href="/tramites">Trámites</a></header>
    <nav><a href="/tramites/dni">DNI</a><a href="/tramites/pasaporte">Pasaporte</a></nav>
    <main>
      <h1>Sacá tu DNI</h1>
      <p>Necesitás el DNI anterior.</p>
      <a href="requisitos#paso">Requisitos</a>
      <a href="https://www.argentina.gob.ar/tramites/dni">Repetido</a>
      <a href="mailto:hola@argentina.gob.ar">Mail</a>
      <a href="javascript:void(0)">Nada</a>
    </main>
    <footer>Pie de página con texto que no queremos.</footer>
    <script>console.log('no')</script>
  </body>
</html>`;

describe('extraerTexto', () => {
  it('extrae título, texto sin menús y links absolutos únicos', () => {
    const resultado = extraerTexto(HTML, 'https://www.argentina.gob.ar/tramites/dni');

    expect(resultado.titulo).toBe('Trámite de DNI');
    expect(resultado.texto).toContain('Sacá tu DNI');
    expect(resultado.texto).toContain('Necesitás el DNI anterior');
    expect(resultado.texto).not.toContain('Pie de página');
    expect(resultado.texto).not.toContain('console.log');
    expect(resultado.texto).not.toContain('Inicio');

    const urls = resultado.links.map((link) => link.url);
    expect(urls).toContain('https://www.argentina.gob.ar/inicio');
    expect(urls).toContain('https://www.argentina.gob.ar/tramites/dni');
    expect(urls).toContain('https://www.argentina.gob.ar/tramites/requisitos');
    expect(urls.every((url) => !url.includes('#'))).toBe(true);
    expect(urls.filter((url) => url.endsWith('/tramites/dni'))).toHaveLength(1);
    expect(urls.some((url) => url.startsWith('mailto:'))).toBe(false);
  });

  it('recorta el texto al máximo configurado', () => {
    const largo = `<html><body>${'a'.repeat(500)}</body></html>`;
    const resultado = extraerTexto(largo, 'https://www.argentina.gob.ar/x', { maxTexto: 100 });
    expect(resultado.texto).toHaveLength(100);
  });
});
