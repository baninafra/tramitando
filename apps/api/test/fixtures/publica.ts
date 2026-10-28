/**
 * Datos de prueba de la API pública.
 *
 * Cubre los tres niveles de jurisdicción, temas y subtemas, una situación de vida, trámites con y
 * sin variantes, costos gratis y con centavos, fuentes por bloque, oficinas y filas de FTS.
 */
import type { ContenidoFicha } from '@tramitando/shared';

function contenido(plazo: string, requiereTurno: boolean): string {
  const ficha: ContenidoFicha = {
    quien_puede: ['Personas mayores de 18 años con DNI vigente'],
    requisitos: [{ texto: 'DNI vigente', aclaracion: null }],
    pasos_online: [{ texto: 'Ingresá al sitio oficial y completá el formulario' }],
    pasos_presencial: [{ texto: 'Sacá un turno y presentate con el DNI' }],
    requiere_turno: requiereTurno,
    turno_url: null,
    plazo,
    consejos: ['Llevá el DNI original y una copia'],
  };
  return JSON.stringify(ficha);
}

export async function cargarFixtures(db: D1Database): Promise<void> {
  const sentencias: D1PreparedStatement[] = [];

  // La base de pruebas se comparte entre corridas: dejamos limpias solo las tablas que usamos.
  for (const tabla of [
    'tramites_fts',
    'variante_fuentes',
    'costos',
    'oficinas',
    'variantes',
    'tramite_temas',
    'tramites',
    'temas',
    'slugs_historicos',
    'fuentes',
    'organismos',
    'jurisdicciones',
  ]) {
    sentencias.push(db.prepare(`DELETE FROM ${tabla}`));
  }

  const insertar = (sql: string, ...valores: (string | number | null)[]) => {
    sentencias.push(db.prepare(sql).bind(...valores));
  };

  insertar(
    `INSERT INTO jurisdicciones (id, nivel, nombre, slug, padre_id, lat, lng) VALUES
      ('nacion', 'nacion', 'Nación', 'nacion', NULL, -34.6, -58.4),
      ('prov-82', 'provincia', 'Santa Fe', 'santa-fe', 'nacion', -31.6, -60.7),
      ('prov-14', 'provincia', 'Córdoba', 'cordoba', 'nacion', -31.4, -64.2),
      ('muni-820441', 'municipio', 'Rosario', 'rosario', 'prov-82', -32.95, -60.64),
      ('muni-820301', 'municipio', 'Rafaela', 'rafaela', 'prov-82', -31.25, -61.49),
      ('muni-140001', 'municipio', 'Córdoba Capital', 'cordoba-capital', 'prov-14', -31.42, -64.18)`,
  );

  insertar(
    `INSERT INTO temas (id, tipo, slug, nombre, descripcion, icono, padre_id, orden, en_portada, estado) VALUES
      (1, 'tema', 'documentos', 'Documentos', 'Trámites de documentos personales', 'file-text', NULL, 1, 1, 'activo'),
      (2, 'tema', 'identidad', 'Identidad', 'DNI y pasaporte', 'id-card', 1, 1, 0, 'activo'),
      (3, 'tema', 'transito', 'Tránsito', 'Licencias y vehículos', 'car', NULL, 2, 1, 'activo'),
      (4, 'tema', 'licencias', 'Licencias de conducir', 'Licencias para manejar', 'car-front', 3, 1, 0, 'activo'),
      (5, 'situacion', 'nacio-mi-hijo', 'Nació mi hijo', 'Primeros trámites del bebé', 'baby', NULL, 3, 1, 'activo'),
      (6, 'tema', 'archivado', 'Tema archivado', 'No debe aparecer en la web', 'x', NULL, 9, 1, 'archivado'),
      (7, 'tema', 'sin-portada', 'Sin portada', 'Tema que no va a la portada', 'folder', NULL, 8, 0, 'activo'),
      (8, 'tema', 'turnos', 'Turnos', 'Trámites de turnos', 'calendar', NULL, 4, 0, 'activo')`,
  );

  insertar(
    `INSERT INTO tramites (id, slug, nombre, nombre_busqueda, resumen, sinonimos, popularidad, estado, creado_en) VALUES
      (1, 'renovar-dni', 'Renovación de DNI', 'Renovar el DNI',
       'Renovar el Documento Nacional de Identidad.', '["documento nacional de identidad","dni"]', 1, 'activo', '2026-01-10T10:00:00Z'),
      (2, 'licencia-de-conducir', 'Licencia de conducir', 'Sacar la licencia de conducir',
       'Obtener o renovar la licencia para manejar.', '["registro de conducir","carnet"]', 3, 'activo', '2026-02-01T10:00:00Z'),
      (3, 'partida-de-nacimiento', 'Partida de nacimiento', 'Pedir la partida de nacimiento',
       'Pedir la partida de nacimiento de una persona.', '["acta de nacimiento"]', 2, 'activo', '2026-03-01T10:00:00Z'),
      (4, 'tramite-archivado', 'Trámite archivado', 'Hacer un trámite archivado',
       'Este trámite ya no se publica.', '[]', 9, 'archivado', '2026-03-01T10:00:00Z'),
      (5, 'tramite-sin-variantes', 'Trámite sin variantes', 'Hacer un trámite sin fichas',
       'Todavía no tiene ninguna ficha publicada.', '[]', 10, 'activo', '2026-03-01T10:00:00Z')`,
  );

  insertar(
    `INSERT INTO tramite_temas (tramite_id, tema_id, principal) VALUES
      (1, 2, 1), (1, 1, 0), (1, 5, 0),
      (2, 4, 1), (2, 3, 0),
      (3, 1, 1),
      (4, 1, 1),
      (5, 1, 1)`,
  );

  insertar(
    `INSERT INTO tramites_fts (nombre, nombre_busqueda, sinonimos, resumen, temas, tramite_id) VALUES
      ('Renovación de DNI', 'Renovar el DNI', 'documento nacional de identidad dni',
       'Renovar el Documento Nacional de Identidad.', 'identidad documentos', 1),
      ('Licencia de conducir', 'Sacar la licencia de conducir', 'registro de conducir carnet',
       'Obtener o renovar la licencia para manejar.', 'licencias transito', 2),
      ('Partida de nacimiento', 'Pedir la partida de nacimiento', 'acta de nacimiento',
       'Pedir la partida de nacimiento de una persona.', 'documentos', 3),
      ('Trámite archivado', 'Hacer un trámite archivado', '',
       'Este trámite ya no se publica.', 'documentos', 4),
      ('Trámite sin variantes', 'Hacer un trámite sin fichas', '',
       'Todavía no tiene ninguna ficha publicada.', 'documentos', 5)`,
  );

  insertar(
    `INSERT INTO organismos (id, slug, nombre, sigla, descripcion, jurisdiccion_id, web) VALUES
      (1, 'renaper', 'RENAPER', 'RENAPER', 'Registro Nacional de las Personas', 'nacion', 'https://www.argentina.gob.ar/interior/renaper'),
      (2, 'registro-civil-santa-fe', 'Registro Civil de Santa Fe', 'RC', 'Registro Civil provincial', 'prov-82', 'https://www.santafe.gob.ar/registro-civil'),
      (3, 'agencia-provincial-seguridad-vial', 'Agencia Provincial de Seguridad Vial', 'APSV', 'Licencias provinciales', 'prov-82', 'https://www.santafe.gob.ar/seguridad-vial'),
      (4, 'municipalidad-de-rosario', 'Municipalidad de Rosario', 'Muni Rosario', 'Tránsito municipal', 'muni-820441', 'https://www.rosario.gob.ar'),
      (5, 'registro-civil-nacional', 'Registro Civil Nacional', 'RCN', 'Partidas y actas', 'nacion', 'https://www.argentina.gob.ar/registro-civil')`,
  );

  insertar(
    `INSERT INTO fuentes (id, url, titulo, organismo_id, ultimo_chequeo, estado_http, creado_en) VALUES
      (1, 'https://www.argentina.gob.ar/interior/renaper', 'RENAPER — DNI', 1, '2026-04-02T00:00:00Z', 200, '2026-01-01T00:00:00Z'),
      (2, 'https://www.santafe.gob.ar/registro-civil', 'Registro Civil de Santa Fe', 2, '2026-04-03T00:00:00Z', 200, '2026-01-01T00:00:00Z'),
      (3, 'https://www.santafe.gob.ar/seguridad-vial', 'Seguridad Vial Santa Fe', 3, '2026-04-04T00:00:00Z', 200, '2026-01-01T00:00:00Z'),
      (4, 'https://www.rosario.gob.ar/movilidad', 'Movilidad Rosario', 4, '2026-04-05T00:00:00Z', 200, '2026-01-01T00:00:00Z'),
      (5, 'https://www.argentina.gob.ar/registro-civil', 'Registro Civil Nacional', 5, '2026-04-06T00:00:00Z', 200, '2026-01-01T00:00:00Z')`,
  );

  insertar(
    `INSERT INTO variantes (id, tramite_id, jurisdiccion_id, organismo_id, estado, verificacion, contenido, verificado_en, proxima_revision, version, actualizado_en) VALUES
      (1, 1, 'nacion', 1, 'publicada', 'verificado', ?, '2026-04-01T00:00:00Z', '2026-07-01T00:00:00Z', 2, '2026-04-01T12:00:00Z'),
      (2, 1, 'prov-82', 2, 'publicada', 'revisar', ?, '2026-04-02T00:00:00Z', '2026-07-02T00:00:00Z', 1, '2026-04-02T12:00:00Z'),
      (3, 2, 'prov-82', 3, 'publicada', 'verificado', ?, '2026-04-03T00:00:00Z', '2026-07-03T00:00:00Z', 1, '2026-04-03T12:00:00Z'),
      (4, 2, 'muni-820441', 4, 'publicada', 'verificado', ?, '2026-04-04T00:00:00Z', '2026-07-04T00:00:00Z', 1, '2026-04-04T12:00:00Z'),
      (5, 3, 'nacion', 5, 'publicada', 'verificado', ?, '2026-04-05T00:00:00Z', '2026-07-05T00:00:00Z', 1, '2026-04-05T12:00:00Z'),
      (6, 4, 'nacion', 1, 'publicada', 'verificado', ?, '2026-04-06T00:00:00Z', '2026-07-06T00:00:00Z', 1, '2026-04-06T12:00:00Z')`,
    contenido('15 días hábiles', true),
    contenido('10 días hábiles', false),
    contenido('30 días hábiles', true),
    contenido('20 días hábiles', true),
    contenido('5 días hábiles', false),
    contenido('90 días hábiles', false),
  );

  insertar(
    `INSERT INTO costos (variante_id, modalidad, monto_centavos, gratis, vigente_desde, nota, fuente_id, orden) VALUES
      (1, 'Trámite normal', 1250000, 0, '2026-01-01', NULL, 1, 0),
      (1, 'Exprés', 2500050, 0, '2026-01-01', 'Entrega en 48 horas', 1, 1),
      (2, 'Trámite normal', NULL, 1, NULL, NULL, 2, 0),
      (3, 'Trámite normal', 8000000, 0, '2026-01-01', NULL, 3, 0),
      (4, 'Trámite normal', 9500000, 0, '2026-01-01', NULL, 4, 0),
      (5, 'Trámite normal', NULL, 1, NULL, NULL, 5, 0)`,
  );

  insertar(
    `INSERT INTO variante_fuentes (variante_id, fuente_id, bloque) VALUES
      (1, 1, 'resumen'), (1, 1, 'quien'), (1, 1, 'requisitos'), (1, 1, 'pasos'), (1, 1, 'costo'),
      (2, 2, 'resumen'), (2, 2, 'quien'), (2, 2, 'requisitos'), (2, 2, 'pasos'), (2, 2, 'costo'),
      (3, 3, 'resumen'), (3, 3, 'quien'), (3, 3, 'requisitos'), (3, 3, 'pasos'), (3, 3, 'costo'),
      (4, 4, 'resumen'), (4, 4, 'quien'), (4, 4, 'requisitos'), (4, 4, 'pasos'), (4, 4, 'costo'),
      (5, 5, 'resumen'), (5, 5, 'quien'), (5, 5, 'requisitos'), (5, 5, 'pasos'), (5, 5, 'costo')`,
  );

  insertar(
    `INSERT INTO oficinas (id, organismo_id, jurisdiccion_id, nombre, direccion, localidad, horario, lat, lng, fuente_id) VALUES
      (1, 1, 'nacion', 'Sede central RENAPER', 'Av. Antártida Argentina 1355', 'Ciudad Autónoma de Buenos Aires', 'Lunes a viernes de 8 a 16', -34.58, -58.37, 1),
      (2, 1, 'prov-82', 'Delegación RENAPER Santa Fe', 'San Martín 1150', 'Santa Fe', 'Lunes a viernes de 8 a 14', -31.63, -60.7, 1),
      (3, 2, 'prov-82', 'Registro Civil Rosario', 'San Luis 1050', 'Rosario', 'Lunes a viernes de 7 a 13', -32.95, -60.64, 2),
      (4, 4, 'muni-820441', 'Centro Municipal de Licencias', 'Córdoba 1000', 'Rosario', 'Lunes a viernes de 8 a 18', -32.94, -60.65, 4),
      (5, 5, 'nacion', 'Registro Civil Central', 'Av. Callao 450', 'Ciudad Autónoma de Buenos Aires', 'Lunes a viernes de 8 a 14', -34.6, -58.39, 5)`,
  );

  insertar(
    `INSERT INTO slugs_historicos (tipo, slug_viejo, slug_nuevo) VALUES
      ('tema', 'documentos-viejo', 'documentos'),
      ('tramite', 'dni-viejo', 'renovar-dni')`,
  );

  // 26 trámites "Turno N" para probar la paginación de 24.
  insertar(
    `WITH RECURSIVE serie(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM serie WHERE i < 26)
     INSERT INTO tramites (id, slug, nombre, nombre_busqueda, resumen, sinonimos, popularidad, estado, creado_en)
     SELECT 100 + i, 'turno-' || i, 'Turno ' || i, 'Sacar turno ' || i,
            'Pedir un turno número ' || i || '.', '[]', i, 'activo', '2026-05-01T00:00:00Z'
       FROM serie`,
  );
  insertar(
    `WITH RECURSIVE serie(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM serie WHERE i < 26)
     INSERT INTO tramite_temas (tramite_id, tema_id, principal)
     SELECT 100 + i, 8, 1 FROM serie`,
  );
  insertar(
    `WITH RECURSIVE serie(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM serie WHERE i < 26)
     INSERT INTO variantes (id, tramite_id, jurisdiccion_id, organismo_id, estado, verificacion, contenido, verificado_en, proxima_revision, version, actualizado_en)
     SELECT 100 + i, 100 + i, 'nacion', 1, 'publicada', 'verificado', ?, '2026-05-01T00:00:00Z',
            '2026-08-01T00:00:00Z', 1, '2026-05-01T12:00:00Z'
       FROM serie`,
    contenido('10 días hábiles', false),
  );
  insertar(
    `WITH RECURSIVE serie(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM serie WHERE i < 26)
     INSERT INTO tramites_fts (nombre, nombre_busqueda, sinonimos, resumen, temas, tramite_id)
     SELECT 'Turno ' || i, 'Sacar turno ' || i, '', 'Pedir un turno número ' || i || '.', 'turnos', 100 + i
       FROM serie`,
  );

  await db.batch(sentencias);
}
