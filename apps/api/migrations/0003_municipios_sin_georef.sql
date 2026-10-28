-- Gobiernos locales que la API Georef no publica (Santa Cruz y Santiago del Estero no tienen
-- municipios en /georef/api/municipios). Ids propios con el prefijo muni-<provincia>-<slug>.
-- Completar con el resto de los municipios de esas provincias a medida que se releven.
INSERT OR IGNORE INTO jurisdicciones (id, nivel, nombre, slug, padre_id, georef_id, lat, lng) VALUES
  ('muni-78-rio-gallegos', 'municipio', 'Río Gallegos', 'rio-gallegos', 'prov-78', NULL, NULL, NULL),
  ('muni-86-santiago-del-estero', 'municipio', 'Santiago del Estero', 'santiago-del-estero', 'prov-86', NULL, NULL, NULL);
