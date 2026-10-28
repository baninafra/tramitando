# Arquitectura de Tramitando

Documento técnico de referencia. La definición de producto está en el doc "Tramitando: definición del proyecto"; la marca, en `brand/manual/`.

## Piezas

```
apps/web        Astro (SSR) en Cloudflare Workers. Web pública. Lee datos de apps/api por service binding.
apps/api        Worker con Hono. Dueño de D1 y R2. API pública de lectura, reportes, admin, ingesta y crons.
packages/shared Esquemas zod y tipos compartidos (contrato de datos).
research        Pipeline de investigación: descarga páginas oficiales y Gemini las estructura.
brand           Manual de marca y logos.
```

Flujo: `research` → (POST `/ingest/v1/*`) → `borradores` en D1 → el admin aprueba en el dashboard (`/admin/v1/*`) → `variantes` publicadas → `apps/web` las lee por `/v1/*`.

## Base de datos

Esquema: `apps/api/migrations/0001_esquema_inicial.sql`. Reglas:

- Fechas ISO 8601 UTC como TEXT. Montos en centavos (INTEGER). JSON como TEXT validado con `@tramitando/shared`.
- Nada se publica sin pasar por `borradores` y una aprobación del admin.
- Toda fuente debe cumplir `esUrlOficial()` de `@tramitando/shared`.

## Temas (taxonomía escalable)

Los temas viven en la base y no en el código, así que se pueden sumar sin desplegar.

- **Dos niveles:** tema (`padre_id` NULL) → subtemas. Más profundidad complica la navegación en celular.
- **Situaciones de vida:** temas con `tipo = 'situacion'` ("Nació mi hijo", "Me mudo"), que agrupan subtemas y trámites de varios temas.
- **Muchos a muchos:** `tramite_temas` permite que un trámite esté en varios temas. Exactamente uno es `principal`, que define las migas de pan y el tema en SEO.
- **Portada:** muestra solo los temas con `en_portada = 1`, ordenados por `orden`. El resto está en `/temas`, que lista todos con sus subtemas.
- **Crecimiento:** cuando la investigación no encuentra un tema adecuado, propone uno en `temas_propuestos`. Eso crea un borrador `tema_nuevo` y el tema queda en `estado = 'propuesto'` hasta que el admin lo aprueba. Nunca aparece en la web un tema no aprobado.
- **Renombrar sin romper links:** al cambiar un slug se guarda el viejo en `slugs_historicos` y la web responde con un 301.
- **Taxonomía inicial:** sale de `research/data/temas.json` (relevamiento de las categorías de los portales oficiales) y se carga con `npm run seed:temas`.

## API (`apps/api`)

Hono sobre Workers. Bindings: `DB` (D1), `PRUEBAS` (R2), `TURNSTILE_SECRET`, `INGEST_TOKEN`, `IP_SALT`, `ACCESS_AUD` y `ACCESS_TEAM` (Cloudflare Access), `ADMIN_DEV` ("1" solo en local: saltea Access).

Todas las respuestas son JSON. Errores: `{ "error": { "codigo": "...", "mensaje": "texto en español para mostrar" } }` con el status HTTP correcto. La validación se hace con los esquemas de `@tramitando/shared` mediante `@hono/zod-validator`.

### Pública de lectura — `/v1` (GET, `Cache-Control: public, max-age=300, s-maxage=3600`)

| Ruta | Devuelve |
| --- | --- |
| `/v1/temas` | Temas activos con sus subtemas y la cantidad de trámites. `?portada=1` filtra los de portada. Incluye situaciones aparte. |
| `/v1/temas/:slug?prov=&muni=&pagina=` | Tema o subtema, sus subtemas y trámites paginados (24 por página). Con ubicación prioriza las variantes de esa jurisdicción. Slug viejo → `{ redirect: slugNuevo }`. |
| `/v1/tramites/:slug` | Trámite genérico, temas y lista de jurisdicciones con variante publicada. |
| `/v1/fichas/:tramite?prov=&muni=` | La variante más cercana: municipio → provincia → Nación. Incluye contenido, costos, oficinas de esa jurisdicción, fuentes por bloque, estado de verificación, `heredada_de` si vino de un nivel superior y `indexable` (false si el municipio pedido no tiene variante propia). |
| `/v1/buscar?q=&prov=&muni=&pagina=` | Búsqueda FTS5 con prefijos y sin tildes. Ranking: bm25 + popularidad + cercanía a la ubicación. |
| `/v1/jurisdicciones?nivel=&padre=` | Provincias o municipios de una provincia, para el selector. |
| `/v1/organismos/:slug` | Organismo, sus trámites y sus oficinas. |
| `/v1/sitemap` | Lista de URLs indexables con `actualizado_en`. |

### Reportes — `POST /v1/reportes`

`multipart/form-data` con los campos de `NuevoReporte` y un archivo opcional `prueba` (imagen jpeg/png/webp, máximo 5 MB, se guarda en R2 con clave `reportes/<uuid>.<ext>`).

- Verifica Turnstile contra `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- Exige prueba: `prueba_url` o archivo. Si es URL, no hace falta que sea oficial, pero se marca si lo es.
- Límite: 5 reportes por `ip_hash` por hora (`ip_hash` = sha-256 de IP + `IP_SALT`; nunca se guarda la IP).
- Respuesta 201 `{ id }`.

### Ingesta — `/ingest/v1` (header `Authorization: Bearer <INGEST_TOKEN>`)

| Ruta | Hace |
| --- | --- |
| `POST /ingest/v1/catalogo` | Recibe hasta 500 `EntradaCatalogo`. Inserta las nuevas (por `url`), ignora las repetidas. Devuelve `{ nuevas, repetidas, invalidas: [{ indice, error }] }`. |
| `GET /ingest/v1/trabajo?limite=10` | Toma ítems abiertos de `cola_trabajo` por prioridad, marca `tomado_en` y devuelve lo necesario para investigarlos (URL del catálogo o la variante actual con sus fuentes). Ítems tomados hace más de 6 horas vuelven a estar disponibles. |
| `POST /ingest/v1/borradores` | Recibe un `BorradorFicha` y el `cola_trabajo_id`. Valida, corre `chequearBorrador`, calcula el diff contra la variante publicada si existe y crea el borrador. Crea borradores `tema_nuevo` para cada tema propuesto. Cierra el ítem de la cola. |
| `POST /ingest/v1/sin-cambios` | Para una revisión sin cambios: registra una `verificacion` de la IA, renueva `verificado_en` y `proxima_revision`, y cierra el ítem. |

### Admin — `/admin/v1` (Cloudflare Access)

Valida el JWT `Cf-Access-Jwt-Assertion` contra las claves de `https://<ACCESS_TEAM>.cloudflareaccess.com/cdn-cgi/access/certs` y la audiencia `ACCESS_AUD`. Con `ADMIN_DEV=1` no valida.

| Ruta | Hace |
| --- | --- |
| `GET /admin/v1/cola?tipo=&pagina=` | Borradores pendientes y reportes pendientes, ordenados por popularidad del trámite. |
| `GET /admin/v1/borradores/:id` | El borrador con el antes y el después campo por campo, chequeos y fuentes. |
| `POST /admin/v1/borradores/:id/aprobar` | Body opcional con el payload editado. Aplica todo en un `DB.batch`: trámite, temas, organismo, variante (version + 1), costos, oficinas, fuentes, `variante_fuentes`, verificación, FTS y estado del catálogo. `proxima_revision` = hoy + 90 días. |
| `POST /admin/v1/borradores/:id/rechazar` | Body `{ motivo }`. Si vino de la cola de trabajo, el ítem vuelve a abrirse con prioridad baja. |
| `GET /admin/v1/reportes/:id` | Reporte con URL firmada de la prueba en R2. |
| `POST /admin/v1/reportes/:id/aceptar` | Crea un ítem `reporte` en la cola de trabajo con prioridad alta. Borra el email. |
| `POST /admin/v1/reportes/:id/rechazar` | Body `{ motivo }`. Borra el email. |
| `GET/POST/PATCH /admin/v1/temas` | CRUD de temas. Un cambio de slug escribe `slugs_historicos`. Aprobar un tema propuesto lo pasa a `activo`. |
| `GET /admin/v1/cobertura` | Fichas por provincia y por estado, catálogo por estado, cola abierta por motivo. |
| `GET /admin/v1/salud` | Fuentes caídas, cambios detectados sin revisar, variantes vencidas. |

### Tareas programadas (`scheduled`)

- **Lunes 06:00 UTC — monitor de fuentes:** recorre `fuentes` en lotes de 50 (un mensaje de Queue por lote si hay más de 1000). Baja cada URL con timeout de 15 s, normaliza el texto (sin scripts, estilos, menús ni fechas de "última actualización"), calcula sha-256 y compara con `huella`. Si cambió: guarda `cambio_detectado_en` y encola `cambio_fuente` para cada variante que usa esa fuente. Guarda `estado_http`.
- **Todos los días 05:00 UTC — vencimientos:** variantes con `proxima_revision` pasada pasan a `verificacion = 'revisar'` y se encola `vencida`. El primer día de cada mes encola `costos` para las variantes con costos.

## Investigación (`research`)

La investigación nunca navega libremente. Nuestro código descarga solo URLs que cumplen `esUrlOficial()`. Gemini 3.8 Flash (Medium, vía Antigravity, sin permisos de red ni de escritura) recibe el texto de esas páginas y devuelve JSON. Así ninguna ficha puede citar una fuente que no sea oficial.

1. **Portales** (`research/data/portales.json`): lista curada de guías de trámites oficiales por jurisdicción.
2. **Descubrimiento:** un crawler por portal recorre la guía oficial (HTML, API JSON o sitemap) y produce `EntradaCatalogo`. Se suben a `/ingest/v1/catalogo`. Así se cubren prácticamente todos los trámites publicados.
3. **Temas:** Gemini clasifica cada entrada del catálogo en los temas existentes.
4. **Fichas:** `research` pide trabajo a `/ingest/v1/trabajo`, descarga la ficha oficial y las páginas oficiales enlazadas que hagan falta (máximo 5, solo dominios oficiales), y le pasa el texto a Gemini con el esquema `BorradorFicha`. Valida con zod y lo sube a `/ingest/v1/borradores`.
5. **Prioridad:** Nación primero y después por población de la jurisdicción y popularidad estimada del trámite.

### Detalles operativos

- **Sitemaps primero:** el catálogo lee los sitemaps oficiales antes de recorrer la guía; así salió casi todo Nación (1975 fichas).
- **Portales con JavaScript:** se abren con el Edge instalado vía `playwright-core` (`--render`, o automático si la página llega casi vacía). Los pedidos de documentos a dominios no oficiales se bloquean.
- **Gemini en Windows:** `agy` corre dentro de WSL; el prompt se pasa por archivo (ver `research/src/gemini.ts`) porque la línea de comandos de Windows corta a ~32 000 caracteres.
- **Corridas largas:** `research/scripts/completar-catalogo.sh` se lanza como proceso independiente y deja el avance en `research/data/logs/`.
- **Cobertura al 2026-10-23:** guía identificada en 21 de 25 jurisdicciones. Sin guía usable: Catamarca (desafío de Cloudflare), Córdoba y Mendoza (bloqueo 403 de CloudFront), La Rioja y Río Negro (sin guía unificada). Misiones y Neuquén tienen guía pero sin fichas individuales que recorrer.
