/**
 * API pública de lectura — `/v1`. Especificación: docs/arquitectura.md.
 *
 * Solo expone contenido publicado: temas activos, trámites activos y variantes publicadas.
 * Todas las respuestas 200 llevan caché pública.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { error } from '../util/errores';
import { CACHE_PUBLICA } from '../consultas/comun';
import { consultaFts, buscar } from '../consultas/buscar';
import { armarFicha, varianteDeFicha } from '../consultas/fichas';
import { listarJurisdicciones, resolverUbicacion } from '../consultas/jurisdicciones';
import { buscarOrganismo, oficinasDeOrganismo, organismoPublico, tramitesDeOrganismo } from '../consultas/organismos';
import { listarSitemap } from '../consultas/sitemap';
import { buscarTema, listarTemas, slugHistorico, subtemasDe, tramitesDelTema } from '../consultas/temas';
import { buscarTramite, jurisdiccionesDeTramite, temasDeTramite, tramitePublico } from '../consultas/tramites';

export const publica = new Hono<{ Bindings: Env }>();

const MENSAJE_PARAMETROS = 'Los parámetros de la consulta no son válidos.';

function validarQuery<T extends z.ZodTypeAny>(esquema: T) {
  return zValidator('query', esquema, (resultado, c) => {
    if (!resultado.success) return error(c, 400, 'parametros_invalidos', MENSAJE_PARAMETROS);
    return;
  });
}

const ubicacion = z.object({
  prov: z.string().trim().min(1).optional(),
  muni: z.string().trim().min(1).optional(),
});

const conPagina = ubicacion.extend({
  pagina: z.coerce.number().int().min(1).default(1),
});

const mensajeUbicacion = (faltante: 'provincia' | 'municipio') =>
  faltante === 'provincia' ? 'No encontramos esa provincia.' : 'No encontramos ese municipio.';

function redirigir(c: Context, slugNuevo: string) {
  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json({ redirect: slugNuevo });
}

publica.get('/temas', validarQuery(z.object({ portada: z.enum(['0', '1']).optional() })), async (c) => {
  const { portada } = c.req.valid('query');
  const datos = await listarTemas(c.env.DB, portada === '1');
  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json(datos);
});

publica.get('/temas/:slug', validarQuery(conPagina), async (c) => {
  const { prov, muni, pagina } = c.req.valid('query');
  const tema = await buscarTema(c.env.DB, c.req.param('slug'));
  if (!tema) {
    const nuevo = await slugHistorico(c.env.DB, 'tema', c.req.param('slug'));
    if (nuevo) return redirigir(c, nuevo);
    return error(c, 404, 'tema_no_encontrado', 'No encontramos ese tema.');
  }

  const lugar = await resolverUbicacion(c.env.DB, prov, muni);
  if (!lugar.ok) return error(c, 404, 'ubicacion_no_encontrada', mensajeUbicacion(lugar.faltante));

  const [subtemas, tramites] = await Promise.all([
    subtemasDe(c.env.DB, tema.id),
    tramitesDelTema(c.env.DB, tema, lugar.ubicacion, pagina),
  ]);

  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json({
    tema: {
      id: tema.id,
      slug: tema.slug,
      nombre: tema.nombre,
      descripcion: tema.descripcion,
      icono: tema.icono,
      tipo: tema.tipo,
      orden: tema.orden,
      en_portada: tema.en_portada === 1,
      padre: tema.padre_slug && tema.padre_nombre ? { slug: tema.padre_slug, nombre: tema.padre_nombre } : null,
    },
    subtemas,
    ...tramites,
  });
});

publica.get('/tramites/:slug', async (c) => {
  const tramite = await buscarTramite(c.env.DB, c.req.param('slug'));
  if (!tramite) {
    const nuevo = await slugHistorico(c.env.DB, 'tramite', c.req.param('slug'));
    if (nuevo) return redirigir(c, nuevo);
    return error(c, 404, 'tramite_no_encontrado', 'No encontramos ese trámite.');
  }

  const [temas, jurisdicciones] = await Promise.all([
    temasDeTramite(c.env.DB, tramite.id),
    jurisdiccionesDeTramite(c.env.DB, tramite.id),
  ]);

  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json({ tramite: tramitePublico(tramite), temas, jurisdicciones });
});

publica.get('/fichas/:tramite', validarQuery(ubicacion), async (c) => {
  const { prov, muni } = c.req.valid('query');
  const tramite = await buscarTramite(c.env.DB, c.req.param('tramite'));
  if (!tramite) {
    const nuevo = await slugHistorico(c.env.DB, 'tramite', c.req.param('tramite'));
    if (nuevo) return redirigir(c, nuevo);
    return error(c, 404, 'tramite_no_encontrado', 'No encontramos ese trámite.');
  }

  const lugar = await resolverUbicacion(c.env.DB, prov, muni);
  if (!lugar.ok) return error(c, 404, 'ubicacion_no_encontrada', mensajeUbicacion(lugar.faltante));

  const encontrada = await varianteDeFicha(c.env.DB, tramite.id, lugar.ubicacion);
  if (!encontrada) return error(c, 404, 'ficha_no_encontrada', 'Todavía no tenemos la ficha de este trámite.');

  const ficha = await armarFicha(c.env.DB, tramite, encontrada, lugar.ubicacion);
  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json(ficha);
});

publica.get(
  '/buscar',
  validarQuery(
    ubicacion.extend({
      q: z.string().default(''),
      pagina: z.coerce.number().int().min(1).default(1),
    }),
  ),
  async (c) => {
    const { q, prov, muni, pagina } = c.req.valid('query');
    const consulta = consultaFts(q);
    if (!consulta) return error(c, 400, 'parametros_invalidos', 'Escribí al menos una palabra para buscar.');

    const lugar = await resolverUbicacion(c.env.DB, prov, muni);
    if (!lugar.ok) return error(c, 404, 'ubicacion_no_encontrada', mensajeUbicacion(lugar.faltante));

    const datos = await buscar(c.env.DB, consulta, lugar.ubicacion, pagina);
    c.header('Cache-Control', CACHE_PUBLICA);
    return c.json(datos);
  },
);

publica.get(
  '/jurisdicciones',
  validarQuery(
    z.object({
      nivel: z.enum(['nacion', 'provincia', 'municipio']).optional(),
      padre: z.string().trim().min(1).optional(),
    }),
  ),
  async (c) => {
    const { nivel, padre } = c.req.valid('query');
    const jurisdicciones = await listarJurisdicciones(c.env.DB, { nivel, padre });
    c.header('Cache-Control', CACHE_PUBLICA);
    return c.json({ jurisdicciones });
  },
);

publica.get('/organismos/:slug', async (c) => {
  const organismo = await buscarOrganismo(c.env.DB, c.req.param('slug'));
  if (!organismo) {
    const nuevo = await slugHistorico(c.env.DB, 'organismo', c.req.param('slug'));
    if (nuevo) return redirigir(c, nuevo);
    return error(c, 404, 'organismo_no_encontrado', 'No encontramos ese organismo.');
  }

  const [tramites, oficinas] = await Promise.all([
    tramitesDeOrganismo(c.env.DB, organismo),
    oficinasDeOrganismo(c.env.DB, organismo.id),
  ]);

  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json({ organismo: organismoPublico(organismo), tramites, oficinas });
});

publica.get('/sitemap', async (c) => {
  const datos = await listarSitemap(c.env.DB);
  c.header('Cache-Control', CACHE_PUBLICA);
  return c.json(datos);
});
