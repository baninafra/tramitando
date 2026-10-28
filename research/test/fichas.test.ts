import { describe, expect, it } from 'vitest';
import type { BorradorFicha } from '@tramitando/shared';
import type { Descarga } from '../src/descargar.js';
import { investigarFicha, type Preguntar } from '../src/fichas.js';
import { desdeItemTrabajo } from '../src/pasos/fichas.js';

const FICHA = 'https://www.argentina.gob.ar/tramites/dni';
const REQUISITOS = 'https://www.argentina.gob.ar/tramites/dni/requisitos';

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

async function descargar(url: string): Promise<Descarga> {
  if (url === FICHA) {
    return descarga(
      url,
      `<html><head><title>DNI</title></head><body>
        <p>Necesitás el DNI anterior.</p>
        <a href="${REQUISITOS}">Requisitos y documentación</a>
      </body></html>`,
    );
  }
  if (url === REQUISITOS) {
    return descarga(url, '<html><body>Llevá tu DNI anterior y una foto.</body></html>');
  }
  throw new Error(`no debería descargarse ${url}`);
}

function borradorConFuente(url: string): BorradorFicha {
  return {
    tramite: {
      slug: 'dni',
      nombre: 'Sacar el DNI',
      nombre_busqueda: 'dni',
      resumen: 'Pedí tu DNI nuevo y listo.',
      sinonimos: [],
      temas: ['documentos'],
      temas_propuestos: [],
    },
    jurisdiccion_id: 'otra',
    organismo: { nombre: 'RENAPER', sigla: null, web: null },
    contenido: {
      quien_puede: ['Todas las personas'],
      requisitos: [{ texto: 'Llevá el DNI anterior', aclaracion: null }],
      pasos_online: [],
      pasos_presencial: [{ texto: 'Andá a la oficina' }],
      requiere_turno: null,
      turno_url: null,
      plazo: null,
      consejos: [],
    },
    costos: [],
    oficinas: [],
    fuentes: [
      {
        url,
        titulo: 'DNI',
        bloques: ['quien', 'requisitos', 'pasos'],
        consultada_en: '2026-10-22T00:00:00.000Z',
      },
    ],
    sin_confirmar: [],
  };
}

function preguntarCon(borrador: BorradorFicha): Preguntar {
  return (async () => borrador) as unknown as Preguntar;
}

const entrada = {
  url: FICHA,
  nombre_oficial: 'Sacar el DNI',
  jurisdiccion_id: 'nacion',
  tramite_slug: 'dni',
};

describe('investigarFicha', () => {
  it('rechaza un borrador que cita una URL que no se descargó', async () => {
    const borrador = borradorConFuente('https://www.argentina.gob.ar/tramites/dni/otra');
    await expect(
      investigarFicha(entrada, {
        descargar,
        preguntar: preguntarCon(borrador),
        temas: ['documentos'],
        promptFicha: 'instrucciones',
        ahora: () => new Date('2026-10-22T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/no se descargaron/i);
  });

  it('acepta un borrador cuyas fuentes son páginas descargadas y corrige la jurisdicción', async () => {
    const resultado = await investigarFicha(entrada, {
      descargar,
      preguntar: preguntarCon(borradorConFuente(FICHA)),
      temas: ['documentos'],
      promptFicha: 'instrucciones',
      ahora: () => new Date('2026-10-22T00:00:00.000Z'),
    });

    expect(resultado.borrador.jurisdiccion_id).toBe('nacion');
    expect(resultado.paginas_descargadas).toContain(FICHA);
    expect(resultado.paginas_descargadas).toContain(REQUISITOS);
  });
});

describe('desdeItemTrabajo', () => {
  it('lee el catálogo anidado que devuelve /ingest/v1/trabajo', () => {
    const pendiente = desdeItemTrabajo({
      cola_trabajo_id: 12,
      motivo: 'nueva',
      catalogo: {
        url: FICHA,
        nombre_oficial: 'Sacar el DNI',
        jurisdiccion_id: 'nacion',
        portal: 'https://www.argentina.gob.ar/tramites',
      },
      variante: null,
    });
    expect(pendiente?.entrada.url).toBe(FICHA);
    expect(pendiente?.entrada.jurisdiccion_id).toBe('nacion');
    expect(pendiente?.colaTrabajoId).toBe(12);
  });

  it('usa el slug y las fuentes de una variante existente', () => {
    const pendiente = desdeItemTrabajo({
      cola_trabajo_id: 13,
      motivo: 'vencida',
      catalogo: null,
      variante: {
        id: 4,
        tramite_slug: 'renovar-dni',
        jurisdiccion_id: 'nacion',
        fuentes: [{ url: FICHA }],
      },
    });
    expect(pendiente?.entrada.tramite_slug).toBe('renovar-dni');
    expect(pendiente?.entrada.url).toBe(FICHA);
  });
});

describe('normalizarRespuestaFicha', () => {
  it('corrige nombres de bloque y saca sinónimos largos en vez de rechazar la respuesta', async () => {
    const { normalizarRespuestaFicha } = await import('../src/fichas');
    const r = normalizarRespuestaFicha({
      tramite: { sinonimos: ['corto', 'x'.repeat(90)] },
      fuentes: [{ bloques: ['Requisito', 'pasos_online', 'cualquiera'] }, { bloques: ['inventado'] }],
    }) as { tramite: { sinonimos: string[] }; fuentes: { bloques: string[] }[] };
    expect(r.fuentes[0]!.bloques).toEqual(['requisitos', 'pasos']);
    expect(r.fuentes[1]!.bloques).toEqual(['resumen']);
    expect(r.tramite.sinonimos).toEqual(['corto']);
  });
});

describe('normalizarRespuestaFicha: limpieza para el modelo chico', () => {
  it('saca costos repetidos, completa bloques sin fuente y baja las frases en mayúsculas', async () => {
    const { normalizarRespuestaFicha } = await import('../src/fichas');
    const r = normalizarRespuestaFicha({
      tramite: { nombre: 'Habilitación', resumen: 'Para el COMERCIO DE ALIMENTOS EXPUESTOS.' },
      contenido: {
        quien_puede: ['Vecinos'],
        requisitos: [{ texto: 'Presentá el CARNET DE MANIPULACION DE ALIMENTOS y el CUIT', aclaracion: null }],
        pasos_presencial: ['Pagá la tasa'],
      },
      costos: [{ monto_centavos: 680000 }, { monto_centavos: 680000 }, { modalidad: 'Otro', monto_centavos: 100 }],
      fuentes: [{ url: 'https://x.gob.ar/t', bloques: ['resumen', 'requisitos'] }],
    }) as Record<string, any>;
    expect(r.costos).toHaveLength(2);
    expect(r.fuentes[0].bloques).toEqual(['resumen', 'requisitos', 'quien', 'pasos', 'costo']);
    expect(r.contenido.requisitos[0].texto).toBe('Presentá el carnet de manipulacion de alimentos y el CUIT');
    expect(r.tramite.resumen).toBe('Para el comercio de alimentos expuestos.');
  });
});

describe('normalizarRespuestaFicha: relleno del modelo', () => {
  it('saca los "no se especifica" y los requisitos repetidos', async () => {
    const { normalizarRespuestaFicha } = await import('../src/fichas');
    const r = normalizarRespuestaFicha({
      tramite: { nombre: 'Empleo', resumen: 'x' },
      contenido: {
        quien_puede: ['No se especifica en el texto', 'Vecinos'],
        requisitos: [
          { texto: 'No se especifican requisitos formales en el texto', aclaracion: null },
          { texto: 'No se especifican requisitos formales en el texto', aclaracion: null },
          { texto: 'DNI', aclaracion: null },
          { texto: 'DNI', aclaracion: null },
        ],
        pasos_presencial: ['No hay pasos en el texto', 'Andá a la oficina'],
      },
      fuentes: [{ url: 'https://x.gob.ar/t', bloques: ['resumen'] }],
    }) as Record<string, any>;
    expect(r.contenido.requisitos).toEqual([{ texto: 'DNI', aclaracion: null }]);
    expect(r.contenido.pasos_presencial).toEqual([{ texto: 'Andá a la oficina' }]);
    expect(r.contenido.quien_puede).toEqual(['Vecinos']);
  });
});

describe('normalizarRespuestaFicha: forma de contenido, oficinas y costos', () => {
  it('convierte pasos de texto, completa opcionales y descarta costos sin monto', async () => {
    const { normalizarRespuestaFicha } = await import('../src/fichas');
    const r = normalizarRespuestaFicha({
      tramite: { nombre: 'Licencia', resumen: 'x'.repeat(500) },
      contenido: { pasos_presencial: ['Andá a la oficina'], requisitos: ['DNI'], quien_puede: ['Vecinos'] },
      oficinas: [{ nombre: 'Sede', direccion: 'Calle 1', localidad: 'X' }, { nombre: 'Sin dirección' }],
      costos: [{ monto_centavos: 1000 }, { modalidad: 'Otro' }],
      fuentes: [{ url: 'https://x.gob.ar/t', bloques: ['resumen'] }],
    }) as Record<string, any>;
    expect(r.contenido.pasos_presencial).toEqual([{ texto: 'Andá a la oficina' }]);
    expect(r.contenido.requisitos).toEqual([{ texto: 'DNI', aclaracion: null }]);
    expect(r.contenido.plazo).toBeNull();
    expect(r.tramite.resumen.length).toBe(400);
    expect(r.oficinas).toEqual([{ nombre: 'Sede', direccion: 'Calle 1', localidad: 'X', horario: null, fuente_url: 'https://x.gob.ar/t' }]);
    expect(r.costos).toHaveLength(1);
    expect(r.costos[0]).toMatchObject({ gratis: false, monto_centavos: 1000, modalidad: 'General', fuente_url: 'https://x.gob.ar/t' });
  });
});

describe('pasoFichas con AUTOPUBLICAR', () => {
  it('publica las fichas que pasan los chequeos y deja en borradores las que no', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pasoFichas } = await import('../src/pasos/fichas.js');
    const dirFichas = await mkdtemp(join(tmpdir(), 'fichas-'));
    const aprobadas: (number | string)[] = [];
    let subidas = 0;
    const api = {
      pedirTrabajo: async () => [
        { cola_trabajo_id: 1, catalogo: { url: FICHA, nombre_oficial: 'DNI', jurisdiccion_id: 'nacion' } },
      ],
      subirBorrador: async () => ({ id: (subidas += 1) }),
      aprobarBorrador: async (id: number | string) => { aprobadas.push(id); },
    } as unknown as import('../src/api.js').ClienteApi;
    const tema = (b: BorradorFicha) => ({ ...b, tramite: { ...b.tramite, temas: ['vehiculos-y-licencias'] } });
    const sinPasos = tema(borradorConFuente(FICHA));
    sinPasos.contenido.pasos_presencial = [];
    sinPasos.fuentes[0]!.bloques = ['quien', 'requisitos'];

    const anterior = process.env.AUTOPUBLICAR;
    process.env.AUTOPUBLICAR = '1';
    try {
      await pasoFichas({ descargar, preguntar: preguntarCon(tema(borradorConFuente(FICHA))), api, subir: true, dirFichas });
      await pasoFichas({ descargar, preguntar: preguntarCon(sinPasos), api, subir: true, dirFichas });
    } finally {
      if (anterior === undefined) delete process.env.AUTOPUBLICAR;
      else process.env.AUTOPUBLICAR = anterior;
    }
    expect(subidas).toBe(2);
    expect(aprobadas).toEqual([1]);
  });
});

describe('filtro de noticias', () => {
  it('tipoDePagina devuelve lo que dice el modelo y ante un error sigue como trámite', async () => {
    const { tipoDePagina } = await import('../src/fichas.js');
    const con = (r: unknown) => (async () => r) as unknown as Preguntar;
    expect(await tipoDePagina('x', 'x', 'x', con({ tipo: 'noticia' }))).toBe('noticia');
    expect(await tipoDePagina('x', 'x', 'x', con({ tipo: 'otro' }))).toBe('otro');
    expect(await tipoDePagina('x', 'x', 'x', con({ algo: 1 }))).toBe('tramite');
    const falla = (async () => { throw new Error('sin respuesta'); }) as unknown as Preguntar;
    expect(await tipoDePagina('x', 'x', 'x', falla)).toBe('tramite');
  });

  it('pasoFichas descarta las noticias en vez de armar la ficha', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pasoFichas } = await import('../src/pasos/fichas.js');
    const descartadas: unknown[] = [];
    let subidas = 0;
    const api = {
      pedirTrabajo: async () => [{ cola_trabajo_id: 7, catalogo: { url: FICHA, nombre_oficial: 'Inauguraron la plaza', jurisdiccion_id: 'nacion' } }],
      subirBorrador: async () => { subidas += 1; return { id: 1 }; },
      aprobarBorrador: async () => {},
      descartar: async (id: unknown) => { descartadas.push(id); },
    } as unknown as import('../src/api.js').ClienteApi;
    const preguntar = (async () => ({ tipo: 'noticia' })) as unknown as Preguntar;
    const r = await pasoFichas({ descargar, preguntar, api, subir: true, dirFichas: await mkdtemp(join(tmpdir(), 'fichas-')) });
    expect(r).toHaveLength(0);
    expect(subidas).toBe(0);
    expect(descartadas).toEqual([{ colaTrabajoId: 7 }]);
  });
});

describe('ficha sin requisitos', () => {
  it('investigarFicha la toma como "no es un trámite" en vez de reintentarla para siempre', async () => {
    const { NoEsTramite } = await import('../src/fichas.js');
    let llamada = 0;
    const preguntar = (async () => {
      llamada += 1;
      if (llamada === 1) return { tipo: 'tramite' };
      throw new Error('Gemini no devolvió un JSON válido: [{"code":"too_small","path":["contenido","requisitos"]}]');
    }) as unknown as Preguntar;
    await expect(
      investigarFicha({ url: FICHA, nombre_oficial: 'Empleo', jurisdiccion_id: 'nacion' }, { descargar, preguntar, temas: ['documentos'], promptFicha: 'x' }),
    ).rejects.toBeInstanceOf(NoEsTramite);
  });
});

describe('rehacer una ficha publicada', () => {
  it('desdeItemTrabajo fija el slug de la variante existente', () => {
    const p = desdeItemTrabajo({
      cola_trabajo_id: 3,
      catalogo: { url: FICHA, nombre_oficial: 'DNI', jurisdiccion_id: 'nacion' },
      variante: { id: 9, tramite_slug: 'sacar-el-dni', jurisdiccion_id: 'nacion' },
    } as never);
    expect(p?.entrada.slug_fijo).toBe('sacar-el-dni');
  });
});
