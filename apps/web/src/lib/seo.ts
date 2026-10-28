// Títulos y datos estructurados (schema.org) de las fichas.
import type { Ficha, Ubicacion } from './data';
import { anio, formatoMonto } from './formato';

export function nombreDeLugar(u: Ubicacion): string | undefined {
  return u.municipio?.nombre ?? u.provincia?.nombre;
}

/** "Renovar el DNI: requisitos, costo y turnos (2026)", "Sacar la licencia de conducir en Rosario: …". */
export function tituloFicha(f: Ficha): string {
  const lugar = nombreDeLugar(f.pedido);
  const turnos = f.variante.pasos.turno ? 'requisitos, costo y turnos' : 'requisitos, costo y plazos';
  return `${f.tramite.nombreBusqueda}${lugar ? ` en ${lugar}` : ''}: ${turnos} (${anio(f.variante.verificacion.fecha)})`;
}

export function descripcionFicha(f: Ficha): string {
  const v = f.variante;
  const costo = v.costos.length === 0 ? 'El costo varía según el lugar' : v.costos.every((c) => c.monto === 0) ? 'Es gratis' : `Cuesta desde ${formatoMonto(Math.min(...v.costos.map((c) => c.monto)))}`;
  return `${f.tramite.resumen} ${costo} y tarda ${v.plazo.resolucion.toLowerCase()}. Qué necesitás, paso a paso y dónde se hace, con fuente oficial.`.replace(/ /g, ' ');
}

function textoCostos(f: Ficha): string {
  const cs = f.variante.costos;
  if (cs.length === 0) return f.variante.costoNota ?? 'Varía según el lugar.';
  if (cs.every((c) => c.monto === 0)) return 'Es gratis.';
  return cs.map((c) => `${c.concepto}: ${formatoMonto(c.monto).replace(/ /g, ' ')}`).join('. ') + '.';
}

export function jsonldFicha(f: Ficha, site: URL) {
  const url = new URL(f.url, site).href;
  const v = f.variante;
  const lugar = nombreDeLugar(f.lugarVariante) ?? 'Argentina';
  const pasos = [...(v.pasos.online ?? []), ...(v.pasos.presencial ?? [])];
  const minimo = Math.min(...v.costos.map((c) => c.monto));
  const nombreMin = f.tramite.nombreBusqueda.charAt(0).toLowerCase() + f.tramite.nombreBusqueda.slice(1);

  const faq = [
    { q: `¿Cuánto cuesta ${nombreMin}?`, a: textoCostos(f) },
    { q: `¿Cuánto tarda?`, a: `El plazo habitual es ${v.plazo.resolucion.toLowerCase()}.${v.plazo.entrega ? ` ${v.plazo.entrega}` : ''}` },
    { q: '¿Qué necesito?', a: v.requisitos.map((r) => r.texto).join('. ') + '.' },
    ...(v.pasos.turno ? [{ q: '¿Hace falta turno?', a: v.pasos.turno }] : []),
  ];

  const migas = [
    { name: 'Inicio', item: new URL('/', site).href },
    { name: f.categoria.nombre, item: new URL(`/categorias/${f.categoria.slug}`, site).href },
    { name: f.tramite.nombre, item: url },
  ];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'GovernmentService',
        '@id': `${url}#servicio`,
        name: f.tramite.nombre,
        description: v.resumen ?? f.tramite.resumen,
        serviceType: f.categoria.nombre,
        url,
        areaServed: { '@type': f.lugarVariante.municipio ? 'City' : f.lugarVariante.provincia ? 'State' : 'Country', name: lugar },
        provider: { '@type': 'GovernmentOrganization', name: f.organismo.nombre, url: f.organismo.web },
        availableChannel: f.oficinas.map((o) => ({
          '@type': 'ServiceChannel',
          name: o.nombre,
          serviceLocation: { '@type': 'Place', name: o.nombre, address: `${o.direccion}, ${o.localidad}` },
        })),
      },
      {
        '@type': 'HowTo',
        '@id': `${url}#paso-a-paso`,
        name: f.tramite.nombreBusqueda,
        inLanguage: 'es-AR',
        ...(Number.isFinite(minimo) ? { estimatedCost: { '@type': 'MonetaryAmount', currency: 'ARS', value: minimo } } : {}),
        supply: v.requisitos.map((r) => ({ '@type': 'HowToSupply', name: r.texto })),
        step: pasos.map((p, i) => ({ '@type': 'HowToStep', position: i + 1, text: p.texto })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#preguntas`,
        mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: migas.map((m, i) => ({ '@type': 'ListItem', position: i + 1, ...m })),
      },
    ],
  };
}
