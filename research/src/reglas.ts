/**
 * Clasificación de links de sitios municipales por reglas, sin IA.
 * Decide lo obvio (trámite, sección para recorrer, ruido) y deja como "dudoso" el resto,
 * que después resuelve un modelo local chico.
 */
import type { LinkPagina } from './texto.js';

export type Clase = 'ficha' | 'listado' | 'descartar' | 'dudoso';

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const RUIDO =
  /(noticia|novedad|prensa|agenda|evento|galeria|video|foto|turismo|farmacia|colectivo|boletin|delegacion|enviar mensaje|mensajes\/|pronostico|clima|telefono|intendente|concejo|historia|museo|taxi|uso interno|marco legal|informacion publica|admin|registrate|nuestra ciudad|autoridades|organigrama|gabinete|^gobierno$|\/gobierno\/?$|cultura\/agenda|licitacion|boletin-oficial|transparencia|facebook|instagram|twitter|x\.com|youtube|tiktok|whatsapp|linkedin|mapa-del-sitio|politica-de-privacidad|login|ingresar|contacto$|\/tag\/|\/category\/|\/autor\/|\.(pdf|docx?|xlsx?|jpe?g|png|zip)$)/;

const PALABRAS_TRAMITE =
  /(licencia|habilitacion|tasa|certificado|partida|permiso|inscripcion|turno|libre deuda|carnet|carne|solicitud|registro|reclamo|subsidio|beca|exencion|plan de pago|moratoria|patente|zoonosis|castracion|bromatologia|obras particulares|catastro|planos|defuncion|matrimonio|nacimiento|estacionamiento|multa|infraccion|denuncia|guia de tramite|transferencia|domiciliario|defensa (al|del) consumidor|omic)/;

const SECCION = /^(tramites?|guia de tramites|tramites (online|y servicios|en linea)|servicios( online| al vecino| en linea)?|atencion (al|ciudadana|vecinal)|areas|secretarias|dependencias|mi muni|vecinos)$/;

/** true si el link es ruido seguro (noticias, institucional, redes, archivos). */
export function esRuido(link: LinkPagina): boolean {
  const u = sinTildes(decodeURIComponent(link.url));
  const t = sinTildes(link.texto).replace(/\s+/g, ' ').trim();
  return RUIDO.test(u) || RUIDO.test(t);
}

/** Clasifica un link de un sitio municipal. `hostSitio` es el host del sitio que se recorre. */
export function clasificarPorReglas(link: LinkPagina, hostSitio: string): Clase {
  let u: URL;
  try {
    u = new URL(link.url);
  } catch {
    return 'descartar';
  }
  const url = sinTildes(decodeURIComponent(u.pathname + u.search));
  const texto = sinTildes(link.texto).replace(/\s+/g, ' ').trim();
  if (u.hostname.toLowerCase() !== hostSitio.toLowerCase()) return 'descartar';
  if (u.pathname === '/' || RUIDO.test(url) || RUIDO.test(texto)) return 'descartar';

  const segmentos = u.pathname.split('/').filter(Boolean);
  const bajoTramites = segmentos.some((s) => /^(tramites?|guia-?de-?tramites|guiadetramites)$/.test(sinTildes(s)));
  const ultimo = sinTildes(segmentos.at(-1) ?? '');

  if (/([?&](page|pagina|pag)=\d+|\/page\/\d+\/?$)/.test(url)) return 'listado';
  if (SECCION.test(texto) || /^(tramites?|servicios|guia-?de-?tramites)$/.test(ultimo)) return 'listado';
  if (bajoTramites && segmentos.length >= 2 && !/^(tramites?|servicios?)$/.test(ultimo)) return 'ficha';
  if (PALABRAS_TRAMITE.test(texto) && texto.split(' ').length <= 12) return 'ficha';
  if (PALABRAS_TRAMITE.test(url.replace(/[-_/]/g, ' '))) return 'ficha';
  return 'dudoso';
}

/**
 * Temas obvios por palabras clave del nombre del trámite, sin IA. Solo casos inequívocos: lo que no
 * matchea lo clasifica el modelo. Cada regla da el subtema y su tema padre.
 */
const TEMAS_POR_PALABRAS: [RegExp, string[]][] = [
  [/licencias? (de|para) conduc|carnet de conduc|registro de conductor/, ['licencia-de-conducir', 'vehiculos-y-licencias']],
  [/infraccion|fotomulta|multas? de transito|juzgado de faltas/, ['infracciones-y-multas', 'vehiculos-y-licencias']],
  [/cedula (verde|azul|del (automotor|vehiculo))/, ['cedula-del-vehiculo', 'vehiculos-y-licencias']],
  [/partidas?|actas? de (nacimiento|matrimonio|defuncion)/, ['partidas-y-actas', 'documentos-e-identidad']],
  [/\bdni\b|documento nacional de identidad/, ['dni', 'documentos-e-identidad']],
  [/pasaporte/, ['pasaporte', 'documentos-e-identidad']],
  [/certificado de (residencia|domicilio|convivencia|supervivencia)/, ['certificados-personales', 'documentos-e-identidad']],
  [/antecedentes penales/, ['antecedentes-penales', 'documentos-e-identidad']],
  [/firma digital/, ['firma-digital', 'documentos-e-identidad']],
  [/(carnet|libreta|carne) sanitari|manipula(cion|dor(es)?) de alimentos/, ['carnet-sanitario', 'salud-y-prevencion']],
  [/vacuna/, ['vacunacion', 'salud-y-prevencion']],
  [/certificado unico de discapacidad|\bcud\b/, ['certificado-unico-de-discapacidad', 'discapacidad-y-accesibilidad']],
  [/catastr|mensura|obras? particular|final de obra|permiso de (obra|construccion)|planos? de (obra|construccion)/, ['catastro-e-inmuebles', 'vivienda-y-servicios-del-hogar']],
  [/conexion (de|a la red de) (agua|cloaca)|cloacas?\b/, ['conexion-de-agua-y-cloacas', 'vivienda-y-servicios-del-hogar']],
  [/defensa del consumidor|\bomic\b/, ['defensa-del-consumidor', 'seguridad-y-denuncias']],
  [/matrimonio|union(es)? convivencial/, ['matrimonios-y-uniones-convivenciales', 'familia-y-pareja']],
  [/bomberos|defensa civil/, ['bomberos-y-defensa-civil', 'urgencias-y-emergencias']],
  [/oficina de empleo|bolsa de (trabajo|empleo)/, ['busqueda-de-empleo-y-seguro-de-desempleo', 'trabajo-y-seguridad-social']],
  [/monotributo/, ['monotributo-social-y-general', 'emprendedores-y-monotributo']],
  // Municipales.
  [/seguridad e higiene|derecho de registro e inspeccion/, ['tasa-de-comercio-e-industria', 'tasas-e-impuestos-municipales']],
  [/\babl\b|tasa (de servicios generales|inmobiliaria|por servicios)|alumbrado, barrido/, ['tasa-inmobiliaria-y-servicios', 'tasas-e-impuestos-municipales']],
  [/libre deuda/, ['libre-deuda-municipal', 'tasas-e-impuestos-municipales']],
  [/plan(es)? de (pago|facilidades)|moratoria/, ['planes-de-pago-municipales', 'tasas-e-impuestos-municipales']],
  [/tasa social|exencion de tasa/, ['exenciones-y-tasa-social', 'tasas-e-impuestos-municipales']],
  [/habilitacion (comercial|de comercio|de local|municipal)/, ['habilitacion-comercial', 'comercio-e-industria']],
  [/registro de proveedores|inscripcion de proveedores|concurso de precios|licitacion/, ['proveedores-y-compras', 'comercio-e-industria']],
  [/final de obra/, ['final-de-obra', 'obras-y-construccion']],
  [/permiso de (obra|edificacion|construccion)|visado de planos|obras privadas/, ['permiso-de-obra-y-planos', 'obras-y-construccion']],
  [/numeracion domiciliaria|numero domiciliario|uso de suelo/, ['numeracion-y-uso-de-suelo', 'obras-y-construccion']],
  [/\bpoda\b|extraccion de (arbol|ejemplar)/, ['poda-y-arbolado', 'servicios-urbanos-y-reclamos']],
  [/recoleccion|residuos (domiciliarios|voluminosos)|descacharrado|volquete/, ['recoleccion-de-residuos', 'servicios-urbanos-y-reclamos']],
  [/alumbrado publico|luminaria/, ['alumbrado-publico', 'servicios-urbanos-y-reclamos']],
  [/estacionamiento medido/, ['estacionamiento-medido', 'transito-local']],
  [/juzgado (municipal )?de faltas|tribunal (municipal )?de faltas/, ['juzgado-de-faltas', 'transito-local']],
  [/\bremis|\btaxi|transporte escolar/, ['taxis-remises-y-escolares', 'transito-local']],
  [/cementerio|nicho|inhumacion|exhumacion/, ['nichos-y-parcelas', 'cementerio-y-servicios-funebres']],
  [/castracion|antirrabica/, ['castraciones-y-vacunas', 'animales-y-zoonosis']],
  [/marcas y senales|guias? de (hacienda|traslado)/, ['marcas-senales-y-guias', 'produccion-rural']],
  [/ordenanza|digesto|boletin oficial municipal/, ['ordenanzas-y-normativa', 'gobierno-y-participacion']],
  [/presupuesto participativo/, ['presupuesto-participativo', 'gobierno-y-participacion']],
];

/** Temas por reglas para un trámite, filtrados a los slugs del temario. Vacío si ninguna regla aplica. */
export function temasPorReglas(nombre: string, slugs: Set<string>): string[] {
  const t = sinTildes(nombre).replace(/\s+/g, ' ');
  const temas = TEMAS_POR_PALABRAS.filter(([re]) => re.test(t)).flatMap(([, s]) => s);
  return [...new Set(temas)].filter((s) => slugs.has(s)).slice(0, 4);
}
