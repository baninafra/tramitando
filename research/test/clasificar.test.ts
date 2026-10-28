import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pasoClasificar } from '../src/pasos/clasificar';
import { temasPorReglas } from '../src/reglas';

const temario = {
  temas: [
    { slug: 'vehiculos-y-licencias', nombre: 'Vehículos', descripcion: 'v', subtemas: [{ slug: 'licencia-de-conducir', nombre: 'Licencia', descripcion: 'l', categorias_origen: [] }] },
    { slug: 'salud-y-prevencion', nombre: 'Salud', descripcion: 's', subtemas: [{ slug: 'vacunacion', nombre: 'Vacunas', descripcion: 'va', categorias_origen: [] }] },
  ],
};
const entrada = (n: number, nombre: string, extra: object = {}) => ({
  jurisdiccion_id: 'muni-1', nombre_oficial: nombre, url: `https://x.gob.ar/t/${n}`, organismo: null, portal: 'https://x.gob.ar/', ...extra,
});

let raiz = '';
let dir = '';
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

function preparar(archivos: Record<string, object[]>) {
  raiz = mkdtempSync(join(tmpdir(), 'clasificar-'));
  dir = join(raiz, 'catalogo');
  mkdirSync(dir);
  writeFileSync(join(raiz, 'temas.json'), JSON.stringify(temario));
  for (const [f, e] of Object.entries(archivos)) writeFileSync(join(dir, f), JSON.stringify(e));
  return { dirCatalogo: dir, temasPath: join(raiz, 'temas.json') };
}

describe('clasificar', () => {
  it('resuelve lo obvio por reglas y manda al modelo solo lo pendiente, por número', async () => {
    const rutas = preparar({
      'muni-1.json': [
        entrada(1, 'Licencia de conducir: renovación'),
        entrada(2, 'Turnos del hospital'),
        entrada(3, 'Ya hecho', { temas_sugeridos: ['vacunacion'] }),
        entrada(4, 'Noticias de la semana'),
      ],
    });
    const prompts: string[] = [];
    const n = await pasoClasificar({
      ...rutas,
      preguntar: (async (p: string) => {
        prompts.push(p);
        return { t: { '1': ['salud-y-prevencion', 'inventado'] } };
      }) as never,
    });
    const e = JSON.parse(readFileSync(join(dir, 'muni-1.json'), 'utf8'));
    expect(n).toBe(2);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('1. Turnos del hospital');
    expect(prompts[0]).not.toContain('Licencia');
    expect(prompts[0]).not.toContain('Ya hecho');
    expect(e[0].temas_sugeridos).toEqual(['licencia-de-conducir', 'vehiculos-y-licencias']);
    expect(e[1].temas_sugeridos).toEqual(['salud-y-prevencion']);
    expect(e[2].temas_sugeridos).toEqual(['vacunacion']);
    // El modelo no respondió el 2 (noticias): queda pendiente para la próxima corrida.
    expect('temas_sugeridos' in e[3]).toBe(false);
  });

  it('no reescribe archivos sin pendientes y una tanda fallida no corta el resto', async () => {
    const rutas = preparar({
      'muni-1.json': [entrada(1, 'Ya hecho', { temas_sugeridos: [] })],
      'muni-2.json': [entrada(2, 'Algo dudoso')],
    });
    const antes = statSync(join(dir, 'muni-1.json')).mtimeMs;
    const n = await pasoClasificar({ ...rutas, preguntar: (async () => { throw new Error('fetch failed'); }) as never });
    expect(n).toBe(0);
    expect(statSync(join(dir, 'muni-1.json')).mtimeMs).toBe(antes);
    expect('temas_sugeridos' in JSON.parse(readFileSync(join(dir, 'muni-2.json'), 'utf8'))[0]).toBe(false);
  });

  it('con rehacerVacios vuelve a mandar las que quedaron sin temas', async () => {
    const rutas = preparar({ 'muni-1.json': [entrada(1, 'Turnos', { temas_sugeridos: [] })] });
    const n = await pasoClasificar({ ...rutas, rehacerVacios: true, preguntar: (async () => ({ t: { '1': ['vacunacion'] } })) as never });
    expect(n).toBe(1);
  });

  it('con embeddings asigna lo muy parecido y el resto va al modelo', async () => {
    const rutas = preparar({ 'muni-1.json': [entrada(1, 'Turnos del hospital'), entrada(2, 'Algo raro')] });
    // Temas: [licencia, vacunacion]. "Turnos" cae cerca de vacunación; "Algo raro" no se parece a nada.
    const embeber = async (textos: string[], consulta: boolean) =>
      consulta ? textos.map((t) => (t.startsWith('Turnos') ? [0, 1] : [0.6, 0.8].map((x) => x * 0.5))) : [[1, 0], [0, 1]];
    const prompts: string[] = [];
    const n = await pasoClasificar({
      ...rutas,
      embeber,
      preguntar: (async (p: string) => {
        prompts.push(p);
        return { t: { '1': ['vacunacion'] } };
      }) as never,
    });
    const e = JSON.parse(readFileSync(join(dir, 'muni-1.json'), 'utf8'));
    expect(n).toBe(2);
    expect(e[0].temas_sugeridos).toEqual(['vacunacion', 'salud-y-prevencion']);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('1. Algo raro');
    expect(e[1].temas_sugeridos).toEqual(['vacunacion']);
  });

  it('si el servidor de embeddings no está, sigue con el modelo', async () => {
    const rutas = preparar({ 'muni-1.json': [entrada(1, 'Turnos del hospital')] });
    const n = await pasoClasificar({
      ...rutas,
      embeber: async () => { throw new Error('fetch failed'); },
      preguntar: (async () => ({ t: { '1': ['vacunacion'] } })) as never,
    });
    expect(n).toBe(1);
  });

  it('temasPorReglas solo devuelve slugs del temario', () => {
    const slugs = new Set(['licencia-de-conducir']);
    expect(temasPorReglas('Renovación de LICENCIA de conducir', slugs)).toEqual(['licencia-de-conducir']);
    expect(temasPorReglas('Agenda cultural', slugs)).toEqual([]);
  });
});
