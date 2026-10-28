/**
 * Normalización de HTML a texto estable para comparar la huella de una fuente.
 *
 * El objetivo no es obtener el texto "bonito": es que dos versiones de la misma página den
 * exactamente el mismo texto si cambió una fecha de actualización, un contador de visitas o el
 * contenido de un script. Así el monitor solo marca cambios reales.
 */

const BLOQUES_QUE_SE_DESCARTAN = ['script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer'] as const;

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  iexcl: '¡',
  iquest: '¿',
};

/** Decodifica las entidades HTML habituales, incluidas las numéricas decimales y hexadecimales. */
function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (original, codigo: string) => {
    if (codigo.startsWith('#')) {
      const hexadecimal = codigo[1]?.toLowerCase() === 'x';
      const numero = Number.parseInt(hexadecimal ? codigo.slice(2) : codigo.slice(1), hexadecimal ? 16 : 10);
      if (!Number.isFinite(numero) || numero < 0 || numero > 0x10ffff) return original;
      return String.fromCodePoint(numero);
    }
    return ENTIDADES[codigo] ?? ENTIDADES[codigo.toLowerCase()] ?? original;
  });
}

const TAGS_DE_BLOQUE =
  'p|div|li|tr|h[1-6]|section|article|table|thead|tbody|tfoot|ul|ol|dl|dd|dt|blockquote|pre|form|fieldset|figure|figcaption|main|aside|address|hr';

function quitarElementosCompletos(html: string): string {
  let resultado = html;
  for (const tag of BLOQUES_QUE_SE_DESCARTAN) {
    resultado = resultado.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
    resultado = resultado.replace(new RegExp(`<${tag}\\b[^>]*\\/>`, 'gi'), ' ');
  }
  return resultado;
}

const LINEAS_QUE_SE_DESCARTAN: RegExp[] = [
  /\b(?:última|ultima)\s+(?:actualización|actualizacion|modificación|modificacion|modificado|actualizado)\b/i,
  /\b(?:actualizado|actualizada|modificado|modificada)\b[^\n]*\b\d{1,4}\b/i,
  /\b(?:fecha\s+de\s+)?(?:actualización|actualizacion|modificación|modificacion)\s*:?\s*\d/i,
  /\bvisitas?\b\s*:?\s*[\d.,]+/i,
  /[\d.,]+\s+visitas?\b/i,
  /\bvisitad[oa]s?\b\s*:?\s*[\d.,]+/i,
  /\bcontador\s+de\s+visitas\b/i,
  /\b(?:esta\s+página|esta\s+pagina)\s+(?:fue|ha\s+sido)\s+visitada\b/i,
];

function esLineaDescartable(linea: string): boolean {
  return LINEAS_QUE_SE_DESCARTAN.some((patron) => patron.test(linea));
}

/** Convierte HTML en texto plano y estable (sin scripts, navegación ni metadatos mutables). */
export function normalizarHtml(html: string): string {
  let texto = html.replace(/<!--[\s\S]*?-->/g, ' ');
  texto = quitarElementosCompletos(texto);

  texto = texto.replace(/<br\s*\/?>/gi, '\n');
  texto = texto.replace(new RegExp(`</?(?:${TAGS_DE_BLOQUE})\\b[^>]*>`, 'gi'), '\n');
  texto = texto.replace(/<[^>]*>/g, '');

  texto = decodificarEntidades(texto);

  const lineas = texto
    .split(/\r?\n/)
    .map((linea) => linea.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .filter((linea) => linea.length > 0)
    .filter((linea) => !esLineaDescartable(linea));

  return lineas.join('\n');
}
