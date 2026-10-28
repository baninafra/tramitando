#!/usr/bin/env node
import { lookup } from 'node:dns/promises';
import { ClienteApi } from './api.js';
import { confirmarHost } from './confirmados.js';
import { descargar } from './descargar.js';
import { embeberLocal } from './embeddings.js';
import { preguntarGemini, runnerQwen, URL_QWEN_2B, URL_QWEN_9B } from './gemini.js';
import type { Preguntar } from './fichas.js';
import { cerrarNavegador } from './navegador.js';
import { pasoCatalogo } from './pasos/catalogo.js';
import { pasoClasificar } from './pasos/clasificar.js';
import { pasoFichas } from './pasos/fichas.js';
import { pasoLimpiar } from './pasos/limpiar.js';
import { pasoMunicipioLocal } from './pasos/municipio-local.js';
import { pasoPortales } from './pasos/portales.js';
import { leerSitiosOficiales, pasoSitiosOficiales, pasoVerificarDominios } from './pasos/sitios-oficiales.js';
import { pasoTemas } from './pasos/temas.js';

interface OpcionesCli {
  paso: string;
  jurisdiccion?: string;
  local?: number;
  limite?: number;
  maxPaginas?: number;
  subir: boolean;
  sinCache: boolean;
  render: boolean;
  nombre?: string;
  provincia?: string;
  sitio?: string;
  /** El sitio lo confirmó Gemini aunque no sea .gob/.gov: se acepta su host en esta corrida. */
  confirmado?: boolean;
  rehacerVacios: boolean;
  sinTema: boolean;
  enSeco: boolean;
}

function leerArgumentos(argv: string[]): OpcionesCli {
  const [paso, ...resto] = argv;
  if (!paso) throw new Error(uso());
  const opciones: OpcionesCli = { paso, subir: false, sinCache: false, render: false, rehacerVacios: false, sinTema: false, enSeco: false };

  for (let i = 0; i < resto.length; i += 1) {
    const arg = resto[i] as string;
    const siguiente = () => {
      const valor = resto[i + 1];
      if (valor === undefined || valor.startsWith('--')) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return valor;
    };
    if (arg === '--jurisdiccion') opciones.jurisdiccion = siguiente();
    else if (arg === '--local') opciones.local = Number(siguiente());
    else if (arg === '--limite') opciones.limite = Number(siguiente());
    else if (arg === '--max-paginas') opciones.maxPaginas = Number(siguiente());
    else if (arg === '--subir') opciones.subir = true;
    else if (arg === '--sin-cache') opciones.sinCache = true;
    else if (arg === '--render') opciones.render = true;
    else if (arg === '--nombre') opciones.nombre = siguiente();
    else if (arg === '--provincia') opciones.provincia = siguiente();
    else if (arg === '--sitio') opciones.sitio = siguiente();
    else if (arg === '--confirmado') opciones.confirmado = true;
    else if (arg === '--rehacer-vacios') opciones.rehacerVacios = true;
    else if (arg === '--sin-tema') opciones.sinTema = true;
    else if (arg === '--en-seco') opciones.enSeco = true;
    else throw new Error(`Opción desconocida: ${arg}\n\n${uso()}`);
  }

  for (const [nombre, valor] of [
    ['--local', opciones.local],
    ['--limite', opciones.limite],
    ['--max-paginas', opciones.maxPaginas],
  ] as const) {
    if (valor !== undefined && (!Number.isInteger(valor) || valor < 0)) {
      throw new Error(`${nombre} necesita un número entero`);
    }
  }
  return opciones;
}

function uso(): string {
  return [
    'Uso: npm run investigar -- <paso> [opciones]',
    '',
    'Pasos: portales, catalogo, temas, clasificar, fichas, municipio-local, sitios-oficiales, verificar-dominios, limpiar',
    'Opciones:',
    '  --jurisdiccion <id>   limita a una jurisdicción',
    '  --local <n>           (fichas) toma n entradas del catálogo local',
    '  --limite <n>          (fichas) pide n ítems a /ingest/v1/trabajo',
    '  --max-paginas <n>     (catalogo) máximo de páginas por portal',
    '  --subir               sube el resultado a la API',
    '  --sin-cache           ignora la caché de páginas',
    '  --render              (portales, catalogo) arma las páginas con el navegador',
    '  --nombre, --provincia (municipio-local) nombre del municipio y de su provincia',
    '  --rehacer-vacios      (clasificar) vuelve a clasificar las entradas que quedaron sin temas',
    '  --sin-tema, --en-seco (limpiar) saca también lo que quedó sin tema; solo muestra qué sacaría',
  ].join('\n');
}

async function main(): Promise<void> {
  const opciones = leerArgumentos(process.argv.slice(2));
  const descargarFn = (url: string, opcionesDescarga = {}) =>
    descargar(url, { sinCache: opciones.sinCache, ...opcionesDescarga });
  const preguntar: Preguntar = (prompt, esquema) => preguntarGemini(prompt, esquema);

  switch (opciones.paso) {
    case 'portales':
      await pasoPortales({
        jurisdiccion: opciones.jurisdiccion,
        descargar: descargarFn,
        preguntar,
        renderizar: opciones.render,
      });
      break;
    case 'catalogo':
      await pasoCatalogo({
        jurisdiccion: opciones.jurisdiccion,
        descargar: descargarFn,
        preguntar,
        api: opciones.subir ? new ClienteApi() : undefined,
        subir: opciones.subir,
        maxPaginas: opciones.maxPaginas,
        renderizar: opciones.render,
      });
      break;
    case 'temas':
      await pasoTemas({
        jurisdiccion: opciones.jurisdiccion,
        descargar: descargarFn,
        preguntar,
      });
      break;
    case 'clasificar':
      await pasoClasificar({
        jurisdiccion: opciones.jurisdiccion,
        preguntar,
        rehacerVacios: opciones.rehacerVacios,
        embeber: embeberLocal,
      });
      break;
    case 'fichas':
      await pasoFichas({
        jurisdiccion: opciones.jurisdiccion,
        local: opciones.local,
        limite: opciones.limite,
        descargar: descargarFn,
        preguntar,
        api: opciones.subir ? new ClienteApi() : undefined,
        subir: opciones.subir,
      });
      break;
    case 'municipio-local': {
      if (!opciones.jurisdiccion || !opciones.nombre || !opciones.provincia) {
        throw new Error('municipio-local necesita --jurisdiccion, --nombre y --provincia');
      }
      if (opciones.confirmado && opciones.sitio) confirmarHost(opciones.sitio);
      const nuevas = await pasoMunicipioLocal({
        jurisdiccion: opciones.jurisdiccion,
        nombre: opciones.nombre,
        provincia: opciones.provincia,
        sitio: opciones.sitio,
        descargar: descargarFn,
        // Los hosts adivinados que no existen se descartan con un DNS en paralelo, sin pasar por robots y reintentos.
        resuelve: (host) => lookup(host).then(() => true, () => false),
        sitioConocido: leerSitiosOficiales().get(opciones.jurisdiccion)?.url,
        // Qwen 2B para la mayoría; Qwen 9B para reintentos y sitios difíciles.
        preguntar: (prompt, esquema) =>
          preguntarGemini(prompt, esquema, { runner: (p) => runnerQwen(p, undefined, URL_QWEN_2B) }),
        preguntarFuerte: (prompt, esquema) =>
          preguntarGemini(prompt, esquema, { runner: (p) => runnerQwen(p, undefined, URL_QWEN_9B) }),
        maxPaginas: opciones.maxPaginas,
        renderizar: opciones.render,
      });
      process.exitCode = nuevas > 0 ? 0 : 2;
      break;
    }
    case 'sitios-oficiales':
      await pasoSitiosOficiales();
      break;
    case 'limpiar':
      await pasoLimpiar({ sinTema: opciones.sinTema, enSeco: opciones.enSeco });
      break;
    case 'verificar-dominios':
      await pasoVerificarDominios({ descargar: descargarFn, permitir: confirmarHost });
      break;
    default:
      throw new Error(`Paso desconocido: ${opciones.paso}\n\n${uso()}`);
  }
}

async function ejecutar(): Promise<void> {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await cerrarNavegador();
  }
}

void ejecutar();
