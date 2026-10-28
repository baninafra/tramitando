import { esUrlOficial } from '@tramitando/shared';
import { escribirJson, esperarLinea, leerJson } from '../archivos.js';
import type { DescargarFn } from '../crawler.js';
import type { Preguntar } from '../fichas.js';
import {
  RespuestaDescribirGuia,
  RespuestaIdentificarGuia,
  SemillaPortales,
  type Portal,
  type RespuestaDescribirGuia as DescribirGuia,
  type RespuestaIdentificarGuia as IdentificarGuia,
} from '../esquemas.js';
import { rutaDatos } from '../rutas.js';
import { extraerTexto, type LinkPagina } from '../texto.js';

export interface OpcionesPasoPortales {
  jurisdiccion?: string;
  descargar: DescargarFn;
  preguntar: Preguntar;
  ahora?: () => Date;
  maxSaltos?: number;
  semillaPath?: string;
  salidaPath?: string;
  /** Usa el navegador desde el principio (CLI `--render`). */
  renderizar?: boolean;
}

interface PaginaLeida {
  url: string;
  titulo: string;
  texto: string;
  links: LinkPagina[];
}

function normalizar(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

function resumirPaginas(paginas: PaginaLeida[], enlaces: LinkPagina[]): string {
  const partes: string[] = [];
  for (const [indice, pagina] of paginas.entries()) {
    partes.push(`### Página ${indice + 1}: ${pagina.url}`, `Título: ${pagina.titulo || '(sin título)'}`, '', pagina.texto.slice(0, 10_000), '');
  }
  partes.push('## Links disponibles (elegí SOLO de acá)');
  for (const link of enlaces.slice(0, 250)) {
    partes.push(`- ${link.url} :: ${link.texto.slice(0, 120)}`);
  }
  return partes.join('\n');
}

async function identificarGuia(
  sitio: string,
  deps: { descargar: DescargarFn; preguntar: Preguntar; maxSaltos: number },
): Promise<{ estado: Portal['estado']; guia_url: string | null; paginas: PaginaLeida[]; notas: string | null }> {
  const paginas: PaginaLeida[] = [];
  const enlaces: LinkPagina[] = [];
  const vistos = new Set<string>();
  let actual: string | null = sitio;

  for (let salto = 0; salto <= deps.maxSaltos && actual; salto += 1) {
    let descarga;
    try {
      descarga = await deps.descargar(actual);
    } catch (error) {
      esperarLinea(`  no se pudo abrir ${actual}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (descarga.tipo === 'pdf' || descarga.tipo === 'otro') break;
    const extraida =
      descarga.tipo === 'html'
        ? extraerTexto(descarga.cuerpo, descarga.url_final, { maxTexto: 20_000 })
        : { titulo: '', texto: descarga.cuerpo.slice(0, 20_000), links: [] as LinkPagina[] };
    paginas.push({ url: descarga.url_final, titulo: extraida.titulo, texto: extraida.texto, links: extraida.links });
    for (const link of extraida.links) {
      if (!esUrlOficial(link.url)) continue;
      const limpia = normalizar(link.url);
      if (vistos.has(limpia)) continue;
      vistos.add(limpia);
      enlaces.push(link);
    }

    const prompt = [
      'Sos un investigador de trámites públicos de la Argentina.',
      'Tenés el texto y los links de páginas oficiales ya descargadas. NO navegues: solo podés elegir URLs de la lista de links.',
      'Tu tarea es encontrar la guía, el portal de trámites o el buscador oficial de trámites de esta jurisdicción.',
      'Si la página actual todavía no es la guía pero tiene un link prometedor (por ejemplo "Trámites", "Guía de trámites", "Servicios"), devolvé ese link en siguiente_url.',
      'Si encontraste la guía, devolvé su URL en guia_url y estado "ok".',
      'Si el sitio depende de JavaScript y no hay contenido útil, usá estado "requiere_js". Si no hay nada, usá "no_encontrado".',
      '',
      `Sitio de partida: ${sitio}`,
      '',
      resumirPaginas(paginas, enlaces),
      '',
      'Respondé SOLO con JSON: {"estado":"ok|no_encontrado|requiere_js","guia_url":"https://..."|null,"siguiente_url":"https://..."|null,"motivo":"..."|null}',
    ].join('\n');

    const respuesta: IdentificarGuia = await deps.preguntar(prompt, RespuestaIdentificarGuia);
    const leidas = new Set(paginas.map((pagina) => normalizar(pagina.url)));
    const guia =
      respuesta.guia_url &&
      (vistos.has(normalizar(respuesta.guia_url)) || leidas.has(normalizar(respuesta.guia_url)))
        ? normalizar(respuesta.guia_url)
        : null;
    if (guia) {
      return { estado: 'ok', guia_url: guia, paginas, notas: respuesta.motivo };
    }
    if (respuesta.estado === 'requiere_js' && !respuesta.siguiente_url) {
      return { estado: 'requiere_js', guia_url: null, paginas, notas: respuesta.motivo };
    }
    const siguiente =
      respuesta.siguiente_url && vistos.has(normalizar(respuesta.siguiente_url))
        ? normalizar(respuesta.siguiente_url)
        : null;
    if (!siguiente || salto === deps.maxSaltos) {
      return { estado: respuesta.estado, guia_url: null, paginas, notas: respuesta.motivo };
    }
    actual = siguiente;
  }

  return { estado: 'no_encontrado', guia_url: null, paginas, notas: null };
}

async function describirGuia(
  guiaUrl: string,
  paginas: PaginaLeida[],
  deps: { descargar: DescargarFn; preguntar: Preguntar },
): Promise<DescribirGuia> {
  const enlaces = paginas.flatMap((p) => p.links).filter((l) => esUrlOficial(l.url));
  const prompt = [
    'Sos un investigador de trámites públicos de la Argentina.',
    'Ya encontramos la guía oficial de trámites. Describí cómo recorrerla usando SOLO el texto y los links provistos; no navegues.',
    'Devolvé:',
    '- listado_urls: URLs de listado o buscador por donde conviene empezar (pueden ser varias).',
    '- paginacion: cómo se pagina (por ejemplo "?pagina=N" o "?page=N"), en texto corto.',
    '- regex_fichas: una expresión regular (sin barras) que matchee las URLs de fichas de trámites individuales y NO las de listado ni las de categorías.',
    '- categorias: categorías de trámites con su URL.',
    '',
    'El regex se aplica sobre la URL completa (https://...). Ejemplo: "/tramites/[a-z0-9-]+/[a-z0-9-]+$".',
    'Todas las URLs tienen que salir de los links provistos o de la propia guía.',
    '',
    resumirPaginas(paginas, enlaces),
    '',
    'Respondé SOLO con JSON: {"listado_urls":["https://..."],"paginacion":"..."|null,"regex_fichas":"..."|null,"categorias":[{"nombre":"...","url":"https://..."}],"notas":"..."|null}',
  ].join('\n');
  return deps.preguntar(prompt, RespuestaDescribirGuia);
}

export async function pasoPortales(opciones: OpcionesPasoPortales): Promise<Portal[]> {
  const semilla = SemillaPortales.parse(
    await leerJson(opciones.semillaPath ?? rutaDatos('portales-semilla.json')),
  );
  const jurisdicciones = semilla.jurisdicciones.filter(
    (j) => !opciones.jurisdiccion || j.jurisdiccion_id === opciones.jurisdiccion,
  );
  if (jurisdicciones.length === 0) throw new Error(`No hay semilla para la jurisdicción ${opciones.jurisdiccion}`);

  // Se suma a lo que ya hay en portales.json y se guarda después de cada jurisdicción,
  // para no perder el trabajo si la corrida se corta.
  const salidaPath = opciones.salidaPath ?? rutaDatos('portales.json');
  const previos = new Map<string, Portal>();
  try {
    const existente = (await leerJson(salidaPath)) as { portales?: Portal[] };
    for (const p of existente.portales ?? []) previos.set(p.jurisdiccion_id, p);
  } catch {
    // Primera corrida: no hay archivo.
  }
  const salida: Portal[] = [];
  const guardar = () =>
    escribirJson(salidaPath, {
      generado_en: (opciones.ahora ?? (() => new Date()))().toISOString(),
      portales: [...previos.values()],
    });
  const descargarRender: DescargarFn = (url, opcionesDescarga = {}) =>
    opciones.descargar(url, { renderizar: true, ...opcionesDescarga });
  const descargarBase = opciones.renderizar ? descargarRender : opciones.descargar;
  for (const jurisdiccion of jurisdicciones) {
    esperarLinea(`→ ${jurisdiccion.nombre} (${jurisdiccion.jurisdiccion_id})`);
    let portal: Portal | null = null;
    for (const sitio of jurisdiccion.sitios) {
      esperarLinea(`  sitio ${sitio}`);
      let descargarSitio = descargarBase;
      let encontrado: Awaited<ReturnType<typeof identificarGuia>>;
      try {
        encontrado = await identificarGuia(sitio, {
          descargar: descargarSitio,
          preguntar: opciones.preguntar,
          maxSaltos: opciones.maxSaltos ?? 3,
        });
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        esperarLinea(`  error: ${motivo}`);
        portal = {
          jurisdiccion_id: jurisdiccion.jurisdiccion_id,
          nombre: jurisdiccion.nombre,
          estado: 'no_encontrado',
          sitio,
          guia_url: null,
          listado_urls: [],
          paginacion: null,
          regex_fichas: null,
          categorias: [],
          notas: motivo.slice(0, 500),
        };
        continue;
      }
      if (!encontrado.guia_url && encontrado.estado === 'requiere_js' && descargarSitio !== descargarRender) {
        esperarLinea('  requiere JavaScript: reintentando con el navegador');
        try {
          encontrado = await identificarGuia(sitio, {
            descargar: descargarRender,
            preguntar: opciones.preguntar,
            maxSaltos: opciones.maxSaltos ?? 3,
          });
          descargarSitio = descargarRender;
        } catch (error) {
          esperarLinea(
            `  render falló: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!encontrado.guia_url) {
        portal = {
          jurisdiccion_id: jurisdiccion.jurisdiccion_id,
          nombre: jurisdiccion.nombre,
          estado: encontrado.estado,
          sitio,
          guia_url: null,
          listado_urls: [],
          paginacion: null,
          regex_fichas: null,
          categorias: [],
          notas: encontrado.notas,
        };
        esperarLinea(`  ${encontrado.estado}`);
        continue;
      }

      let guiaPaginas = encontrado.paginas;
      const yaLeida = guiaPaginas.find((p) => normalizar(p.url) === normalizar(encontrado.guia_url as string));
      if (!yaLeida) {
        try {
          const descarga = await descargarSitio(encontrado.guia_url);
          if (descarga.tipo === 'html') {
            const extraida = extraerTexto(descarga.cuerpo, descarga.url_final);
            guiaPaginas = [
              ...guiaPaginas,
              { url: descarga.url_final, titulo: extraida.titulo, texto: extraida.texto, links: extraida.links },
            ];
          }
        } catch (error) {
          esperarLinea(`  no se pudo leer la guía: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let descripcion: DescribirGuia = {
        listado_urls: [encontrado.guia_url],
        paginacion: null,
        regex_fichas: null,
        categorias: [],
        notas: null,
      };
      try {
        descripcion = await describirGuia(encontrado.guia_url, guiaPaginas, {
          descargar: descargarSitio,
          preguntar: opciones.preguntar,
        });
      } catch (error) {
        esperarLinea(`  no se pudo describir la guía: ${error instanceof Error ? error.message : String(error)}`);
      }

      let regex: string | null = descripcion.regex_fichas;
      if (regex) {
        try {
          new RegExp(regex);
        } catch {
          esperarLinea(`  regex inválida, se descarta: ${regex}`);
          regex = null;
        }
      }
      const listado = descripcion.listado_urls.filter((u) => esUrlOficial(u));
      portal = {
        jurisdiccion_id: jurisdiccion.jurisdiccion_id,
        nombre: jurisdiccion.nombre,
        estado: 'ok',
        sitio,
        guia_url: encontrado.guia_url,
        listado_urls: listado.length > 0 ? listado : [encontrado.guia_url],
        paginacion: descripcion.paginacion,
        regex_fichas: regex,
        categorias: descripcion.categorias.filter((c) => esUrlOficial(c.url)),
        notas: descripcion.notas ?? encontrado.notas,
      };
      esperarLinea(`  guía encontrada: ${encontrado.guia_url}`);
      break;
    }
    salida.push(
      portal ?? {
        jurisdiccion_id: jurisdiccion.jurisdiccion_id,
        nombre: jurisdiccion.nombre,
        estado: 'no_encontrado',
        sitio: jurisdiccion.sitios[0] as string,
        guia_url: null,
        listado_urls: [],
        paginacion: null,
        regex_fichas: null,
        categorias: [],
        notas: null,
      },
    );
    const ultimo = salida[salida.length - 1] as Portal;
    previos.set(ultimo.jurisdiccion_id, ultimo);
    await guardar();
  }

  await guardar();
  esperarLinea(`Guardado ${salidaPath} (${salida.filter((p) => p.estado === 'ok').length} ok de ${salida.length})`);
  return salida;
}
