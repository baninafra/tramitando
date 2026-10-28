# tramitando-web

Frontend público de Tramitando: Astro 7 con SSR en Cloudflare Workers (`@astrojs/cloudflare` 14), TypeScript y CSS propio con los tokens del manual de marca. Casi sin JS en el cliente: solo el checklist, la ubicación guardada y la validación del formulario de reporte.

> **Datos.** Por defecto el sitio lee de la API (`apps/api`). Para trabajar sin API, poné `DATOS_EJEMPLO=1` en `apps/web/.dev.vars`: usa `src/lib/datos-ejemplo.ts`, con montos, plazos y direcciones inventados. Un aviso arriba de cada página lo recuerda.

## Cómo correrlo

Necesitás Node 22 o más nuevo.

```bash
npm install
cp apps/api/.dev.vars.ejemplo apps/api/.dev.vars
cp apps/web/.dev.vars.ejemplo apps/web/.dev.vars
npm run db:migrar -w @tramitando/api
```

En una terminal levantá la API y cargá los datos:

```bash
npm run dev -w @tramitando/api                 # http://localhost:8787
npm run seed:temas -w @tramitando/api          # si existe research/data/temas.json
npm run seed:ejemplo -w @tramitando/api        # publica las fichas de ejemplo por el flujo real
```

En otra terminal levantá la web:

```bash
npm run dev -w @tramitando/web                 # http://localhost:4321
```

`npm run seed:ejemplo` crea temas, entradas de catálogo, borradores y los aprueba con el admin local (`ADMIN_DEV=1`). Es idempotente: si una ficha ya está publicada, la saltea.

Otros comandos, desde la raíz:

```bash
npm run build -w @tramitando/web      # genera dist/ (server + client)
npm run preview -w @tramitando/web    # sirve el build en workerd
npm run check -w @tramitando/web      # chequeo de tipos de Astro
npm test -w @tramitando/api           # tests de la API con D1 de miniflare
```

Si `npm install` avisa sobre scripts de `esbuild` y `workerd`, aprobalos con `npm approve-scripts esbuild workerd`: bajan los binarios.

### Turnstile en desarrollo

El formulario de reportes usa las claves de prueba de Cloudflare: site key `1x00000000000000000000AA` y secret `1x0000000000000000000000000000000AA` (ya está en `.dev.vars.ejemplo` de la API). La site key se lee de `PUBLIC_TURNSTILE_SITE_KEY`; en producción se configura en el Worker de la web.

## Qué hay

| Ruta | Pantalla |
| --- | --- |
| `/` | Portada: buscador, más buscados, selector de ubicación, categorías |
| `/buscar?q=&prov=&muni=` | Resultados (tolera errores de tipeo y sinónimos: "registo" → licencia). `noindex` |
| `/categorias/<slug>` | Categoría |
| `/tramites/<tramite>` | Ficha nacional, o índice de lugares si el trámite no tiene versión nacional |
| `/tramites/<tramite>/<provincia>[/<municipio>]` | Ficha. Sin datos propios hereda la del nivel de arriba con `noindex` |
| `/imprimir/<tramite>/...` | Checklist para imprimir o guardar en PDF. `noindex` |
| `/ubicacion` | Elegir provincia y municipio (destino sin JS del botón de ubicación de la cabecera) |
| `/organismos/<slug>` | Organismo: qué es, sus trámites y oficinas |
| `/quienes-somos`, `/como-verificamos`, `/aviso-legal`, `/privacidad` | Páginas fijas |
| `/sitemap.xml` | Sitemap con la fecha de verificación como `lastmod` |

URLs de ejemplo para probar: `/tramites/renovacion-de-dni`, `/tramites/licencia-de-conducir/santa-fe/rosario`, `/tramites/licencia-de-conducir/santa-fe/santo-tome` (heredada), `/tramites/licencia-de-conducir/cordoba/cordoba` (sin datos), `/tramites/partida-de-nacimiento/buenos-aires` (vencida: "Puede estar desactualizado").

Cada ficha lleva `GovernmentService`, `HowTo`, `FAQPage` y `BreadcrumbList` en JSON-LD (solo las indexables), y el título tiene la forma "Renovar el DNI: requisitos, costo y turnos (2026)".

## Ubicación y selectores

- En todas las páginas, la cabecera tiene un botón de ubicación que abre un diálogo con provincia y municipio. En una ficha, al elegir te lleva a la ficha de ese lugar. Lo elegido queda solo en el navegador (`localStorage`).
- La portada pregunta qué trámite y dónde en el mismo formulario.
- "Usar mi ubicación" toma el GPS del navegador y sugiere el municipio cargado más cercano (25 km) o la capital provincial más cercana. Es aproximado y solo completa los campos: la persona confirma. Para afinarlo hacen falta los polígonos de provincias y municipios.
- Los desplegables son propios (`src/scripts/selector.ts`): mejoran un `<select>` nativo con el patrón *combobox* de WAI-ARIA (flechas, Inicio/Fin, Enter, Esc y búsqueda tipeando). Sin JS queda el `<select>` nativo con el mismo estilo.

## Estructura

```
src/
  lib/data.ts            tipos del modelo + funciones async que usan las páginas (única puerta a los datos)
  lib/api.ts             cliente de la API: service binding en producción, fetch local en desarrollo
  lib/datos-ejemplo.ts   datos de ejemplo (solo los importa data.ts cuando DATOS_EJEMPLO=1)
  lib/formato.ts         $ 12.500, 14/10/2026
  lib/seo.ts             títulos y schema.org de las fichas
  components/            Sello, FichaTramite, Checklist, Buscador, Ubicacion, CamposUbicacion, Reporte, FichaCompleta, Icono
  scripts/               selector (desplegables), ubicacion (guardar y sugerir lugar), gps
  components/iconos.ts   íconos Lucide generados por scripts/generar-iconos.mjs
  layouts/               Base (cabecera, pie con aviso legal, SEO) y PaginaFija
  styles/tokens.css      tokens del manual (claro y oscuro con prefers-color-scheme)
public/                  logos SVG finales del manual, favicon, robots.txt
```

## Cómo se conecta con la API

La web no accede a D1: todo pasa por `apps/api`.

- En producción usa el service binding `API` declarado en `wrangler.jsonc`, que apunta al Worker `tramitando-api`.
- En desarrollo (`import.meta.env.DEV`) usa `fetch` a `API_URL` (`http://localhost:8787` por defecto), así no hace falta desplegar nada.
- `src/lib/api.ts` concentra el cliente y los tipos de respuesta. `src/lib/data.ts` traduce entre el contrato de la API y los tipos que usan las páginas.
- `src/middleware.ts` configura el binding en cada request con `import { env } from 'cloudflare:workers'`.

### Reportes

`components/Reporte.astro` envía el formulario a `POST /api/reporte`, un proxy en `src/pages/api/reporte.ts`. El proxy arma el `multipart/form-data` que espera `POST /v1/reportes`, agrega `CF-Connecting-IP` y devuelve el JSON de la API.

La API valida Turnstile, exige una prueba (link o imagen de hasta 5 MB), guarda la imagen en R2 y limita a 5 reportes por IP por hora. La IP se guarda solo como hash con sal. El admin revisa el reporte y, si lo acepta, entra a la cola de investigación.

### Datos de ejemplo

Con `DATOS_EJEMPLO=1` la web no toca la API: `data.ts` usa `datos-ejemplo.ts`. Sirve para trabajar en pantallas o cuando la API no está levantada. El seed de la API usa esos mismos datos para publicarlos por el flujo real de ingesta y aprobación.

## Pendientes fuera de esta tarea

- **Caché en el borde**: guardar el HTML de cada ficha con la Cache API e invalidarlo al aprobar un cambio.
- **Sesiones**: el adaptador avisa "Enabling sessions with Cloudflare KV" y al hacer deploy aprovisionaría un KV `SESSION`. El sitio no usa sesiones; revisá antes del deploy si conviene desactivarlo.
- **Textos legales** (aviso legal, privacidad) marcados como provisorios.
- **Dominio** (`site` en `astro.config.mjs`) a confirmar.
- Sitemap por provincia cuando haya muchas fichas.

## Notas

- `persistState: false` en `astro.config.mjs`: en Windows, con rutas de carpeta muy largas, workerd no puede abrir su SQLite local y el prerender falla. La web no usa D1; en desarrollo los datos salen por `fetch` a la API. `preview` sí usa el service binding y necesita la API disponible.
- En Windows con rutas largas, `wrangler d1` local puede fallar con `SQLITE_CANTOPEN`. Usá la misma ruta corta para migrar y para levantar la API: `npx wrangler d1 migrations apply tramitando --local --persist-to C:/Temp/tramitando-d1` y `npx wrangler dev --port 8787 --persist-to C:/Temp/tramitando-d1`.
- La tipografía Figtree se sirve desde el propio sitio (`@fontsource-variable/figtree`), no desde Google Fonts: es más rápido y no manda la IP de quien visita a un tercero.
- El tema oscuro solo se aplica en pantalla (`@media screen`), así que lo que se imprime siempre sale claro.
- `typescript` está fijado en 5.x porque `@astrojs/check` todavía no anda con TypeScript 7.
