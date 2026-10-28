-- Tramitando · esquema inicial (D1 / SQLite)
-- Contrato compartido por la API, los scripts de investigación y la web. Ver docs/arquitectura.md.
-- Fechas: texto ISO 8601 en UTC. Montos: enteros en centavos de peso. JSON: texto validado por @tramitando/shared.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------------------------
-- Geografía
-- ---------------------------------------------------------------------------------------------

-- Nación, las 24 jurisdicciones de primer nivel y los gobiernos locales (ids de Georef cuando existen).
CREATE TABLE jurisdicciones (
  id            TEXT PRIMARY KEY,                 -- 'nacion' | 'prov-06' | 'muni-060441'
  nivel         TEXT NOT NULL CHECK (nivel IN ('nacion', 'provincia', 'municipio')),
  nombre        TEXT NOT NULL,
  slug          TEXT NOT NULL,                    -- único dentro de su padre
  padre_id      TEXT REFERENCES jurisdicciones(id),
  georef_id     TEXT,
  lat           REAL,
  lng           REAL,
  UNIQUE (padre_id, slug)
);
CREATE INDEX idx_jurisdicciones_padre ON jurisdicciones(padre_id);

-- ---------------------------------------------------------------------------------------------
-- Temas: taxonomía abierta de dos niveles + situaciones de vida
-- ---------------------------------------------------------------------------------------------

-- Un tema de primer nivel tiene padre_id NULL; un subtema apunta a su tema. Las situaciones de vida
-- ("Nació mi hijo") son temas de tipo 'situacion' sin padre. Se crean y aprueban desde el dashboard.
CREATE TABLE temas (
  id               INTEGER PRIMARY KEY,
  tipo             TEXT NOT NULL DEFAULT 'tema' CHECK (tipo IN ('tema', 'situacion')),
  slug             TEXT NOT NULL UNIQUE,
  nombre           TEXT NOT NULL,
  descripcion      TEXT NOT NULL DEFAULT '',
  icono            TEXT,                          -- nombre de ícono Lucide
  padre_id         INTEGER REFERENCES temas(id),
  orden            INTEGER NOT NULL DEFAULT 0,
  en_portada       INTEGER NOT NULL DEFAULT 0,    -- 1 = aparece en la portada
  estado           TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('propuesto', 'activo', 'archivado')),
  creado_en        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_temas_padre ON temas(padre_id, orden);

-- Slugs viejos de temas, trámites y organismos para redirigir con 301 cuando algo se renombra.
CREATE TABLE slugs_historicos (
  tipo        TEXT NOT NULL CHECK (tipo IN ('tema', 'tramite', 'organismo')),
  slug_viejo  TEXT NOT NULL,
  slug_nuevo  TEXT NOT NULL,
  creado_en   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (tipo, slug_viejo)
);

-- ---------------------------------------------------------------------------------------------
-- Organismos y oficinas
-- ---------------------------------------------------------------------------------------------

CREATE TABLE organismos (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  nombre           TEXT NOT NULL,
  sigla            TEXT,
  descripcion      TEXT NOT NULL DEFAULT '',
  jurisdiccion_id  TEXT NOT NULL REFERENCES jurisdicciones(id),
  web              TEXT
);

CREATE TABLE fuentes (
  id                   INTEGER PRIMARY KEY,
  url                  TEXT NOT NULL UNIQUE,      -- solo dominios oficiales (ver shared/dominios)
  titulo               TEXT,
  organismo_id         INTEGER REFERENCES organismos(id),
  huella               TEXT,                      -- sha-256 del texto normalizado
  ultimo_chequeo       TEXT,
  estado_http          INTEGER,
  cambio_detectado_en  TEXT,                      -- se limpia al aprobar una revisión
  creado_en            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE oficinas (
  id               INTEGER PRIMARY KEY,
  organismo_id     INTEGER NOT NULL REFERENCES organismos(id),
  jurisdiccion_id  TEXT NOT NULL REFERENCES jurisdicciones(id),
  nombre           TEXT NOT NULL,
  direccion        TEXT NOT NULL,
  localidad        TEXT NOT NULL,
  horario          TEXT,
  lat              REAL,
  lng              REAL,
  fuente_id        INTEGER REFERENCES fuentes(id)
);
CREATE INDEX idx_oficinas_jurisdiccion ON oficinas(jurisdiccion_id);

-- ---------------------------------------------------------------------------------------------
-- Trámites y fichas
-- ---------------------------------------------------------------------------------------------

-- El trámite genérico existe una sola vez para todo el país.
CREATE TABLE tramites (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  nombre           TEXT NOT NULL,                 -- "Renovación de DNI"
  nombre_busqueda  TEXT NOT NULL,                 -- "Renovar el DNI"
  resumen          TEXT NOT NULL,
  sinonimos        TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
  popularidad      INTEGER,                       -- menor = más buscado
  estado           TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'archivado')),
  creado_en        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Un trámite puede estar en varios temas; exactamente uno es el principal (migas de pan y SEO).
CREATE TABLE tramite_temas (
  tramite_id  INTEGER NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
  tema_id     INTEGER NOT NULL REFERENCES temas(id),
  principal   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tramite_id, tema_id)
);
CREATE INDEX idx_tramite_temas_tema ON tramite_temas(tema_id);
CREATE UNIQUE INDEX idx_tramite_tema_principal ON tramite_temas(tramite_id) WHERE principal = 1;

CREATE TABLE tramites_relacionados (
  tramite_id     INTEGER NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
  relacionado_id INTEGER NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
  PRIMARY KEY (tramite_id, relacionado_id)
);

-- La variante es la ficha publicada: un trámite en una jurisdicción.
CREATE TABLE variantes (
  id                 INTEGER PRIMARY KEY,
  tramite_id         INTEGER NOT NULL REFERENCES tramites(id),
  jurisdiccion_id    TEXT NOT NULL REFERENCES jurisdicciones(id),
  organismo_id       INTEGER REFERENCES organismos(id),
  estado             TEXT NOT NULL DEFAULT 'publicada' CHECK (estado IN ('publicada', 'archivada')),
  verificacion       TEXT NOT NULL DEFAULT 'verificado' CHECK (verificacion IN ('verificado', 'revisar')),
  contenido          TEXT NOT NULL,               -- JSON ContenidoFicha (@tramitando/shared)
  verificado_en      TEXT NOT NULL,
  proxima_revision   TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  actualizado_en     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (tramite_id, jurisdiccion_id)
);
CREATE INDEX idx_variantes_revision ON variantes(proxima_revision);

CREATE TABLE costos (
  id               INTEGER PRIMARY KEY,
  variante_id      INTEGER NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  modalidad        TEXT NOT NULL,                 -- "Trámite normal", "Exprés", "Online"
  monto_centavos   INTEGER,                       -- NULL si es gratis
  gratis           INTEGER NOT NULL DEFAULT 0,
  vigente_desde    TEXT,
  nota             TEXT,
  fuente_id        INTEGER REFERENCES fuentes(id),
  orden            INTEGER NOT NULL DEFAULT 0,
  CHECK (gratis = 1 OR monto_centavos IS NOT NULL)
);
CREATE INDEX idx_costos_variante ON costos(variante_id);

-- Qué fuente respalda qué bloque de qué ficha.
CREATE TABLE variante_fuentes (
  variante_id  INTEGER NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  fuente_id    INTEGER NOT NULL REFERENCES fuentes(id),
  bloque       TEXT NOT NULL,                     -- resumen | costo | plazo | quien | requisitos | pasos | donde | consejos
  PRIMARY KEY (variante_id, fuente_id, bloque)
);
CREATE INDEX idx_variante_fuentes_fuente ON variante_fuentes(fuente_id);

CREATE TABLE verificaciones (
  id           INTEGER PRIMARY KEY,
  variante_id  INTEGER NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  fecha        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  autor        TEXT NOT NULL CHECK (autor IN ('ia', 'admin')),
  resultado    TEXT NOT NULL CHECK (resultado IN ('sin_cambios', 'actualizada', 'creada')),
  notas        TEXT
);

-- ---------------------------------------------------------------------------------------------
-- Investigación y revisión
-- ---------------------------------------------------------------------------------------------

-- Catálogo de trámites descubiertos en portales oficiales, antes de tener ficha.
CREATE TABLE catalogo (
  id               INTEGER PRIMARY KEY,
  url              TEXT NOT NULL UNIQUE,          -- ficha oficial del trámite
  nombre_oficial   TEXT NOT NULL,
  jurisdiccion_id  TEXT NOT NULL REFERENCES jurisdicciones(id),
  organismo        TEXT,
  temas_sugeridos  TEXT NOT NULL DEFAULT '[]',    -- JSON string[] de slugs
  portal           TEXT NOT NULL,                 -- de qué portal salió
  prioridad        INTEGER NOT NULL DEFAULT 100,  -- menor = antes
  estado           TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'en_investigacion', 'en_revision', 'publicado', 'descartado')),
  tramite_id       INTEGER REFERENCES tramites(id),
  variante_id      INTEGER REFERENCES variantes(id),
  descubierto_en   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actualizado_en   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_catalogo_estado ON catalogo(estado, prioridad);
CREATE INDEX idx_catalogo_jurisdiccion ON catalogo(jurisdiccion_id);

-- Trabajo pendiente para la investigación: fichas nuevas o a revisar.
CREATE TABLE cola_trabajo (
  id           INTEGER PRIMARY KEY,
  catalogo_id  INTEGER REFERENCES catalogo(id),
  variante_id  INTEGER REFERENCES variantes(id),
  motivo       TEXT NOT NULL CHECK (motivo IN ('nueva', 'cambio_fuente', 'vencida', 'reporte', 'costos')),
  prioridad    INTEGER NOT NULL DEFAULT 100,
  creado_en    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  tomado_en    TEXT,
  cerrado_en   TEXT,
  CHECK (catalogo_id IS NOT NULL OR variante_id IS NOT NULL)
);
CREATE INDEX idx_cola_abierta ON cola_trabajo(cerrado_en, tomado_en, prioridad);

-- Todo cambio de contenido pasa por acá y espera la aprobación del admin.
CREATE TABLE borradores (
  id            INTEGER PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ficha_nueva', 'actualizacion', 'tema_nuevo')),
  origen        TEXT NOT NULL CHECK (origen IN ('ia', 'reporte', 'admin')),
  catalogo_id   INTEGER REFERENCES catalogo(id),
  variante_id   INTEGER REFERENCES variantes(id),
  reporte_id    INTEGER REFERENCES reportes(id),
  payload       TEXT NOT NULL,                    -- JSON BorradorFicha | BorradorTema
  diff          TEXT,                             -- JSON con los campos que cambian (actualizaciones)
  chequeos      TEXT NOT NULL DEFAULT '[]',       -- JSON resultado de controles automáticos
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  motivo        TEXT,
  creado_en     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revisado_en   TEXT
);
CREATE INDEX idx_borradores_estado ON borradores(estado, creado_en);

CREATE TABLE reportes (
  id              INTEGER PRIMARY KEY,
  variante_id     INTEGER NOT NULL REFERENCES variantes(id),
  bloque          TEXT NOT NULL,
  descripcion     TEXT NOT NULL,
  valor_correcto  TEXT,
  prueba_url      TEXT,
  prueba_r2_key   TEXT,
  email           TEXT,                           -- opcional; se borra al cerrar
  ip_hash         TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptado', 'rechazado')),
  motivo          TEXT,
  creado_en       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  cerrado_en      TEXT,
  CHECK (prueba_url IS NOT NULL OR prueba_r2_key IS NOT NULL)
);
CREATE INDEX idx_reportes_estado ON reportes(estado, creado_en);
CREATE INDEX idx_reportes_ip ON reportes(ip_hash, creado_en);

-- ---------------------------------------------------------------------------------------------
-- Búsqueda
-- ---------------------------------------------------------------------------------------------

-- Índice de texto completo. Se reconstruye por trámite al aprobar cambios (ver api/src/busqueda).
CREATE VIRTUAL TABLE tramites_fts USING fts5(
  nombre, nombre_busqueda, sinonimos, resumen, temas,
  tramite_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
