/**
 * ⚠️ DATOS DE EJEMPLO. NO SON DATOS VERIFICADOS. ⚠️
 *
 * Montos, plazos, direcciones, horarios y fechas de este archivo son inventados para probar el
 * diseño. Las URLs de fuentes apuntan a sitios oficiales reales pero no se chequearon. Nada de esto
 * se puede publicar: el contenido real lo cargan las tareas de investigación y lo aprueba el dueño
 * desde el dashboard, y vive en D1.
 *
 * Solo `data.ts` importa este archivo.
 */
import type { Categoria, Jurisdiccion, Oficina, Organismo, Tramite, Variante } from './data';

const PROVINCIAS: [string, string][] = [
  ['buenos-aires', 'Buenos Aires'], ['catamarca', 'Catamarca'], ['chaco', 'Chaco'], ['chubut', 'Chubut'],
  ['ciudad-de-buenos-aires', 'Ciudad de Buenos Aires'], ['cordoba', 'Córdoba'], ['corrientes', 'Corrientes'],
  ['entre-rios', 'Entre Ríos'], ['formosa', 'Formosa'], ['jujuy', 'Jujuy'], ['la-pampa', 'La Pampa'],
  ['la-rioja', 'La Rioja'], ['mendoza', 'Mendoza'], ['misiones', 'Misiones'], ['neuquen', 'Neuquén'],
  ['rio-negro', 'Río Negro'], ['salta', 'Salta'], ['san-juan', 'San Juan'], ['san-luis', 'San Luis'],
  ['santa-cruz', 'Santa Cruz'], ['santa-fe', 'Santa Fe'], ['santiago-del-estero', 'Santiago del Estero'],
  ['tierra-del-fuego', 'Tierra del Fuego'], ['tucuman', 'Tucumán'],
];

// Coordenadas aproximadas de cada capital provincial. Solo sirven para sugerir la provincia con el GPS.
const CAPITALES: Record<string, [number, number]> = {'buenos-aires': [-34.92,-57.95], 'catamarca': [-28.47,-65.78], 'chaco': [-27.45,-58.99], 'chubut': [-43.3,-65.1], 'ciudad-de-buenos-aires': [-34.6,-58.38], 'cordoba': [-31.42,-64.18], 'corrientes': [-27.47,-58.83], 'entre-rios': [-31.73,-60.53], 'formosa': [-26.18,-58.17], 'jujuy': [-24.19,-65.3], 'la-pampa': [-36.62,-64.29], 'la-rioja': [-29.41,-66.86], 'mendoza': [-32.89,-68.83], 'misiones': [-27.37,-55.9], 'neuquen': [-38.95,-68.06], 'rio-negro': [-40.81,-62.99], 'salta': [-24.79,-65.41], 'san-juan': [-31.54,-68.52], 'san-luis': [-33.3,-66.34], 'santa-cruz': [-51.62,-69.22], 'santa-fe': [-31.63,-60.7], 'santiago-del-estero': [-27.8,-64.26], 'tierra-del-fuego': [-54.8,-68.3], 'tucuman': [-26.82,-65.22]};

export const jurisdicciones: Jurisdiccion[] = [
  { slug: 'argentina', nombre: 'Nación', nivel: 'nacion' },
  ...PROVINCIAS.map(([slug, nombre]): Jurisdiccion => ({ slug, nombre, nivel: 'provincia', centro: CAPITALES[slug] })),
  { slug: 'rosario', nombre: 'Rosario', nivel: 'municipio', provincia: 'santa-fe', centro: [-32.95, -60.65] },
  { slug: 'santa-fe', nombre: 'Santa Fe', nivel: 'municipio', provincia: 'santa-fe', centro: [-31.63, -60.7] },
  { slug: 'santo-tome', nombre: 'Santo Tomé', nivel: 'municipio', provincia: 'santa-fe', centro: [-31.66, -60.77] },
  { slug: 'la-plata', nombre: 'La Plata', nivel: 'municipio', provincia: 'buenos-aires', centro: [-34.92, -57.95] },
  { slug: 'general-pueyrredon', nombre: 'General Pueyrredon (Mar del Plata)', nivel: 'municipio', provincia: 'buenos-aires', centro: [-38.0, -57.56] },
  { slug: 'cordoba', nombre: 'Córdoba', nivel: 'municipio', provincia: 'cordoba', centro: [-31.42, -64.18] },
  { slug: 'mendoza', nombre: 'Mendoza', nivel: 'municipio', provincia: 'mendoza', centro: [-32.89, -68.83] },
];

export const categorias: Categoria[] = [
  { slug: 'identidad', nombre: 'Identidad', descripcion: 'DNI, pasaporte, partidas y cambios de datos.', icono: 'id-card' },
  { slug: 'vehiculos', nombre: 'Vehículos', descripcion: 'Licencia de conducir, VTV, patentes y transferencias.', icono: 'car' },
  { slug: 'trabajo', nombre: 'Trabajo', descripcion: 'CUIL, aportes, seguro de desempleo y jubilación.', icono: 'briefcase' },
  { slug: 'familia', nombre: 'Familia', descripcion: 'Nacimientos, matrimonio, asignaciones y defunciones.', icono: 'users' },
  { slug: 'impuestos', nombre: 'Impuestos', descripcion: 'Monotributo, clave fiscal e impuestos locales.', icono: 'receipt' },
  { slug: 'extranjeros', nombre: 'Extranjeros', descripcion: 'Radicación, DNI para extranjeros y residencia.', icono: 'globe' },
];

export const organismos: Organismo[] = [
  {
    slug: 'renaper', nombre: 'Registro Nacional de las Personas', sigla: 'RENAPER',
    descripcion: 'Es el organismo nacional que emite el DNI y el pasaporte. Atiende en sus oficinas y en los registros civiles de todo el país.',
    jurisdiccion: {}, web: 'https://www.argentina.gob.ar/interior/renaper',
  },
  {
    slug: 'anses', nombre: 'Administración Nacional de la Seguridad Social', sigla: 'ANSES',
    descripcion: 'Maneja el CUIL, las jubilaciones, las asignaciones familiares y otras prestaciones de la seguridad social.',
    jurisdiccion: {}, web: 'https://www.anses.gob.ar',
  },
  {
    slug: 'municipalidad-de-rosario', nombre: 'Municipalidad de Rosario',
    descripcion: 'Gobierno de la ciudad de Rosario. Emite la licencia de conducir para quienes viven en la ciudad.',
    jurisdiccion: { provincia: 'santa-fe', municipio: 'rosario' }, web: 'https://www.rosario.gob.ar',
  },
  {
    slug: 'apsv-santa-fe', nombre: 'Agencia Provincial de Seguridad Vial', sigla: 'APSV',
    descripcion: 'Organismo de la provincia de Santa Fe que fija las reglas de la licencia de conducir y habilita a los centros emisores de cada localidad.',
    jurisdiccion: { provincia: 'santa-fe' }, web: 'https://www.santafe.gob.ar',
  },
  {
    slug: 'registro-personas-pba', nombre: 'Registro Provincial de las Personas de Buenos Aires',
    descripcion: 'Registra nacimientos, matrimonios y defunciones en la provincia de Buenos Aires y emite las partidas.',
    jurisdiccion: { provincia: 'buenos-aires' }, web: 'https://www.gba.gob.ar/registrodelaspersonas',
  },
];

export const oficinas: Oficina[] = [
  { id: 'renaper-plaza-miserere', organismo: 'renaper', nombre: 'Centro de Documentación Plaza Miserere', direccion: 'Av. Rivadavia 2900 (dirección de ejemplo)', localidad: 'Ciudad de Buenos Aires', horario: 'Lunes a viernes de 8 a 14 h', mapaUrl: 'https://www.openstreetmap.org/search?query=Plaza%20Miserere%20Buenos%20Aires', fuente: 'renaper-oficinas' },
  { id: 'renaper-rosario', organismo: 'renaper', nombre: 'Registro Civil Rosario Centro', direccion: 'Calle de ejemplo 1200', localidad: 'Rosario, Santa Fe', horario: 'Lunes a viernes de 7:30 a 13 h', mapaUrl: 'https://www.openstreetmap.org/search?query=Rosario%20Santa%20Fe', fuente: 'renaper-oficinas' },
  { id: 'anses-udai-centro', organismo: 'anses', nombre: 'UDAI Centro', direccion: 'Calle de ejemplo 500', localidad: 'Ciudad de Buenos Aires', horario: 'Lunes a viernes de 8 a 14 h', mapaUrl: 'https://www.openstreetmap.org/search?query=ANSES%20Buenos%20Aires', fuente: 'anses-cuil' },
  { id: 'rosario-licencias', organismo: 'municipalidad-de-rosario', nombre: 'Centro Municipal de Licencias', direccion: 'Av. de ejemplo 3800', localidad: 'Rosario, Santa Fe', horario: 'Lunes a viernes de 7 a 13 h', mapaUrl: 'https://www.openstreetmap.org/search?query=Rosario%20Santa%20Fe', fuente: 'rosario-licencias' },
  { id: 'pba-la-plata', organismo: 'registro-personas-pba', nombre: 'Delegación La Plata', direccion: 'Calle de ejemplo 7 n.º 1000', localidad: 'La Plata, Buenos Aires', horario: 'Lunes a viernes de 8 a 13 h', mapaUrl: 'https://www.openstreetmap.org/search?query=La%20Plata', fuente: 'pba-partidas' },
];

export const tramites: Tramite[] = [
  {
    slug: 'renovacion-de-dni', nombre: 'Renovación de DNI', nombreBusqueda: 'Renovar el DNI', categoria: 'identidad',
    resumen: 'Sirve para sacar un DNI nuevo cuando el tuyo venció, se rompió o tenés que actualizar la foto. El número no cambia.',
    sinonimos: ['documento', 'dni', 'renovar', 'actualizacion', 'ejemplar', 'nuevo dni'],
    relacionados: ['constancia-de-cuil'], popularidad: 1,
  },
  {
    slug: 'licencia-de-conducir', nombre: 'Licencia de conducir (primera vez)', nombreBusqueda: 'Sacar la licencia de conducir', categoria: 'vehiculos',
    resumen: 'Es el permiso para manejar. La primera vez tenés que hacer un curso, un examen teórico, uno práctico y un control médico.',
    sinonimos: ['registro', 'carnet', 'carnet de conducir', 'licencia', 'manejar', 'conducir', 'brevet'],
    relacionados: ['renovacion-de-dni'], popularidad: 2,
  },
  {
    slug: 'partida-de-nacimiento', nombre: 'Partida de nacimiento', nombreBusqueda: 'Pedir la partida de nacimiento', categoria: 'familia',
    resumen: 'Es el documento que prueba dónde y cuándo naciste. Te la piden para casarte, para algunos trámites del DNI y para jubilarte.',
    sinonimos: ['acta', 'acta de nacimiento', 'certificado de nacimiento', 'partida'],
    relacionados: ['renovacion-de-dni'], popularidad: 3,
  },
  {
    slug: 'constancia-de-cuil', nombre: 'Constancia de CUIL', nombreBusqueda: 'Sacar la constancia de CUIL', categoria: 'trabajo',
    resumen: 'Es el número que te identifica como trabajador ante la seguridad social. La constancia te la piden al empezar un trabajo.',
    sinonimos: ['cuil', 'cuit', 'numero de cuil', 'anses'],
    relacionados: ['renovacion-de-dni'], popularidad: 4,
  },
];

const verif = (fecha: string, proximaRevision: string, enRevision = false) => ({ fecha, proximaRevision, enRevision });

export const variantes: Variante[] = [
  {
    id: 'dni-nacion', tramite: 'renovacion-de-dni', organismo: 'renaper',
    costos: [
      { concepto: 'Trámite normal', monto: 12500, vigenteDesde: '2026-09-01', fuente: 'renaper-aranceles' },
      { concepto: 'Exprés (en 24 a 48 h hábiles)', monto: 31000, vigenteDesde: '2026-09-01', fuente: 'renaper-aranceles' },
      { concepto: 'En el día', monto: 45000, vigenteDesde: '2026-09-01', fuente: 'renaper-aranceles' },
    ],
    mediosDePago: ['Tarjeta de débito o crédito', 'Mercado Pago', 'Efectivo en algunas oficinas'],
    plazo: { resolucion: '15 días hábiles', entrega: 'Te llega por correo a tu domicilio o lo retirás en la oficina.', fuente: 'renaper-aranceles' },
    quienPuede: ['Cualquier persona argentina o extranjera con residencia que ya tenga DNI.', 'Las personas menores de edad lo hacen con su madre, padre o tutor.'],
    requisitos: [
      { id: 'dni-anterior', texto: 'Tu DNI anterior', aclaracion: 'Aunque esté vencido o roto. Si lo perdiste, el trámite es otro: duplicado por extravío.', fuente: 'renaper-requisitos' },
      { id: 'turno', texto: 'El turno confirmado', aclaracion: 'En el celular o impreso.', fuente: 'renaper-requisitos' },
      { id: 'pago', texto: 'El medio de pago', fuente: 'renaper-aranceles' },
      { id: 'partida', texto: 'Partida de nacimiento', aclaracion: 'Solo si cambiaste algún dato personal.', fuente: 'renaper-requisitos' },
    ],
    pasos: {
      turno: 'Hace falta turno. Lo sacás online en Mi Argentina.',
      online: [
        { texto: 'Entrá a Mi Argentina con tu cuenta y elegí "Turnos".', enlace: { texto: 'Ir a Mi Argentina', url: 'https://www.argentina.gob.ar/miargentina' } },
        { texto: 'Buscá "Renovación de DNI" y elegí la oficina más cercana.' },
        { texto: 'Elegí día y horario. Te llega la confirmación por email.' },
      ],
      presencial: [
        { texto: 'Andá a la oficina el día del turno, unos minutos antes.' },
        { texto: 'Pagá el trámite si no lo pagaste antes.' },
        { texto: 'Te sacan la foto, la firma y las huellas.' },
        { texto: 'Guardá el comprobante: con él seguís el envío.' },
      ],
    },
    oficinas: ['renaper-plaza-miserere', 'renaper-rosario'],
    consejos: [
      'Llevá tu DNI anterior aunque esté vencido: sin él no te lo renuevan.',
      'Revisá que tu domicilio esté bien antes de la foto. Si te mudaste, el trámite es "cambio de domicilio".',
      'El turno no se puede pasar a otra persona.',
    ],
    fuentes: [
      { id: 'renaper-requisitos', titulo: 'Renovar el DNI — argentina.gob.ar', url: 'https://www.argentina.gob.ar/servicio/renovar-el-dni', respalda: ['resumen', 'quien', 'requisitos', 'pasos', 'consejos'], verificadaEl: '2026-10-14' },
      { id: 'renaper-aranceles', titulo: 'Valores de los trámites del RENAPER — argentina.gob.ar', url: 'https://www.argentina.gob.ar/interior/renaper', respalda: ['costo', 'plazo'], verificadaEl: '2026-10-14' },
      { id: 'renaper-oficinas', titulo: 'Oficinas del RENAPER — argentina.gob.ar', url: 'https://www.argentina.gob.ar/interior/renaper', respalda: ['oficinas'], verificadaEl: '2026-10-10' },
    ],
    verificacion: verif('2026-10-14', '2027-01-14'),
  },
  {
    id: 'licencia-rosario', tramite: 'licencia-de-conducir', provincia: 'santa-fe', municipio: 'rosario', organismo: 'municipalidad-de-rosario',
    resumen: 'En Rosario la emite la Municipalidad. Te sirve para manejar en todo el país.',
    costos: [
      { concepto: 'Licencia clase B (autos), por 5 años', monto: 38900, vigenteDesde: '2026-08-01', fuente: 'rosario-licencias' },
      { concepto: 'Certificado nacional de antecedentes de tránsito', monto: 6200, vigenteDesde: '2026-08-01', fuente: 'rosario-licencias' },
    ],
    mediosDePago: ['Tarjeta de débito o crédito', 'Transferencia'],
    plazo: { resolucion: 'En el día', entrega: 'Si aprobás todo, te la dan ese mismo día.', fuente: 'rosario-licencias' },
    quienPuede: ['Personas de 17 años o más que vivan en Rosario.', 'A los 17 necesitás la autorización de tu madre, padre o tutor.'],
    requisitos: [
      { id: 'dni', texto: 'DNI con domicilio en Rosario', aclaracion: 'Si tu DNI tiene otro domicilio, primero hacé el cambio.', fuente: 'rosario-licencias' },
      { id: 'curso', texto: 'Constancia del curso de educación vial', fuente: 'rosario-licencias' },
      { id: 'grupo', texto: 'Constancia de grupo sanguíneo', fuente: 'rosario-licencias' },
      { id: 'antecedentes', texto: 'Certificado de antecedentes de tránsito pagado', fuente: 'rosario-licencias' },
      { id: 'anteojos', texto: 'Anteojos o lentes, si los usás', aclaracion: 'Te los piden en el examen de vista.', fuente: 'rosario-licencias' },
    ],
    pasos: {
      turno: 'Hace falta turno. Lo sacás en la web de la Municipalidad.',
      online: [
        { texto: 'Hacé el curso de educación vial online.' },
        { texto: 'Pedí el turno en la web de la Municipalidad.', enlace: { texto: 'Ir a rosario.gob.ar', url: 'https://www.rosario.gob.ar' } },
      ],
      presencial: [
        { texto: 'Presentate con los papeles el día del turno.' },
        { texto: 'Hacé el examen médico (vista, oído y psicofísico).' },
        { texto: 'Rendí el examen teórico.' },
        { texto: 'Rendí el examen práctico con tu auto.' },
        { texto: 'Pagá y retirá la licencia.' },
      ],
    },
    oficinas: ['rosario-licencias'],
    consejos: [
      'El auto para el examen práctico tiene que tener el seguro y la VTV al día.',
      'Si desaprobás el teórico, podés volver a rendirlo después de unos días.',
    ],
    fuentes: [
      { id: 'rosario-licencias', titulo: 'Licencia de conducir — Municipalidad de Rosario', url: 'https://www.rosario.gob.ar', respalda: ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'oficinas', 'consejos'], verificadaEl: '2026-10-08' },
    ],
    verificacion: verif('2026-10-08', '2027-01-08'),
  },
  {
    id: 'licencia-santa-fe', tramite: 'licencia-de-conducir', provincia: 'santa-fe', organismo: 'apsv-santa-fe',
    resumen: 'En Santa Fe cada localidad tiene su centro emisor, pero las reglas y el examen son los mismos en toda la provincia.',
    costos: [],
    costoNota: 'El costo de la licencia lo fija cada municipio. Aparte se paga el certificado nacional de antecedentes de tránsito.',
    mediosDePago: [],
    plazo: { resolucion: 'Depende de cada centro emisor', fuente: 'apsv-licencias' },
    quienPuede: ['Personas de 17 años o más que vivan en la provincia de Santa Fe.'],
    requisitos: [
      { id: 'dni', texto: 'DNI con domicilio en la localidad donde la sacás', fuente: 'apsv-licencias' },
      { id: 'curso', texto: 'Constancia del curso de educación vial', fuente: 'apsv-licencias' },
      { id: 'antecedentes', texto: 'Certificado de antecedentes de tránsito', fuente: 'apsv-licencias' },
    ],
    pasos: {
      turno: 'Cada centro emisor da sus propios turnos.',
      presencial: [
        { texto: 'Buscá el centro emisor de tu localidad.' },
        { texto: 'Hacé el examen médico, el teórico y el práctico.' },
      ],
    },
    oficinas: [],
    consejos: ['El costo de la licencia lo fija cada municipio: consultalo en el tuyo.'],
    fuentes: [
      { id: 'apsv-licencias', titulo: 'Licencia de conducir — Gobierno de Santa Fe', url: 'https://www.santafe.gob.ar', respalda: ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'consejos'], verificadaEl: '2026-09-30' },
    ],
    verificacion: verif('2026-09-30', '2026-12-30'),
  },
  {
    id: 'partida-pba', tramite: 'partida-de-nacimiento', provincia: 'buenos-aires', organismo: 'registro-personas-pba',
    resumen: 'Si naciste en la provincia de Buenos Aires, la pedís al Registro Provincial. Hay versión digital con firma válida.',
    costos: [
      { concepto: 'Partida digital', monto: 3500, vigenteDesde: '2026-07-01', fuente: 'pba-partidas' },
      { concepto: 'Partida en papel, en la delegación', monto: 4800, vigenteDesde: '2026-07-01', fuente: 'pba-partidas' },
    ],
    mediosDePago: ['Tarjeta de débito o crédito', 'Pago en efectivo con boleta'],
    plazo: { resolucion: '3 a 5 días hábiles', entrega: 'La digital te llega por email. La de papel la retirás en la delegación.', fuente: 'pba-partidas' },
    quienPuede: ['La persona de la partida, sus padres, hijos o cónyuge.', 'Otra persona con una autorización firmada.'],
    requisitos: [
      { id: 'dni', texto: 'Tu DNI', fuente: 'pba-partidas' },
      { id: 'datos', texto: 'Nombre completo, fecha y lugar de nacimiento', aclaracion: 'Si los tenés, también el tomo y el número de acta.', fuente: 'pba-partidas' },
      { id: 'vinculo', texto: 'Algo que pruebe el vínculo', aclaracion: 'Solo si pedís la partida de otra persona.', fuente: 'pba-partidas' },
    ],
    pasos: {
      online: [
        { texto: 'Entrá a la web del Registro y elegí "Partida digital".', enlace: { texto: 'Ir al Registro', url: 'https://www.gba.gob.ar/registrodelaspersonas' } },
        { texto: 'Completá los datos y pagá.' },
        { texto: 'Esperá el email con la partida en PDF.' },
      ],
      presencial: [
        { texto: 'Andá a la delegación con tu DNI.' },
        { texto: 'Pedí la partida, pagá y guardá el comprobante.' },
        { texto: 'Volvé a retirarla en la fecha que te indiquen.' },
      ],
    },
    oficinas: ['pba-la-plata'],
    consejos: ['La partida digital tiene la misma validez que la de papel.', 'Revisá que tu nombre esté bien escrito antes de pagar.'],
    fuentes: [
      { id: 'pba-partidas', titulo: 'Partidas — Registro Provincial de las Personas', url: 'https://www.gba.gob.ar/registrodelaspersonas', respalda: ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'oficinas', 'consejos'], verificadaEl: '2026-07-02' },
    ],
    // Vencida a propósito para mostrar el estado "Puede estar desactualizado".
    verificacion: verif('2026-07-02', '2026-10-02'),
  },
  {
    id: 'cuil-nacion', tramite: 'constancia-de-cuil', organismo: 'anses',
    costos: [{ concepto: 'Constancia online o en oficina', monto: 0, vigenteDesde: '2026-01-01', fuente: 'anses-cuil' }],
    mediosDePago: [],
    plazo: { resolucion: 'En el momento', entrega: 'La descargás en PDF.', fuente: 'anses-cuil' },
    quienPuede: ['Cualquier persona con DNI argentino.'],
    requisitos: [
      { id: 'dni', texto: 'Tu número de DNI', fuente: 'anses-cuil' },
      { id: 'datos', texto: 'Tu nombre, sexo y fecha de nacimiento como figuran en el DNI', fuente: 'anses-cuil' },
    ],
    pasos: {
      online: [
        { texto: 'Entrá a la página de constancia de CUIL de ANSES.', enlace: { texto: 'Ir a ANSES', url: 'https://www.anses.gob.ar/consulta/constancia-de-cuil' } },
        { texto: 'Completá tus datos.' },
        { texto: 'Descargá o imprimí la constancia.' },
      ],
      presencial: [{ texto: 'Si no te aparece online, pedí turno en una oficina de ANSES y llevá tu DNI.' }],
    },
    oficinas: ['anses-udai-centro'],
    consejos: ['Si el sistema dice que tus datos no coinciden, revisá cómo figuran en el DNI, letra por letra.'],
    fuentes: [
      { id: 'anses-cuil', titulo: 'Constancia de CUIL — ANSES', url: 'https://www.anses.gob.ar/consulta/constancia-de-cuil', respalda: ['resumen', 'costo', 'plazo', 'quien', 'requisitos', 'pasos', 'oficinas', 'consejos'], verificadaEl: '2026-10-12' },
    ],
    verificacion: verif('2026-10-12', '2027-01-12'),
  },
];
