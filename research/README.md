# Investigación

Pipeline que descubre trámites en portales oficiales y le pide a Gemini que los estructure
como `BorradorFicha`. Nuestro código es el único que navega: Gemini solo lee el texto que le
pasamos. Toda URL pasa por `esUrlOficial()` de `@tramitando/shared`.

## Requisitos

- `agy-delegate` en el `PATH` (Gemini 3.8 Flash Medium, vía Antigravity).
- Para subir a la API: `TRAMITANDO_API` (por defecto `http://localhost:8787`) e `INGEST_TOKEN`.

Gemini corre sin `--yolo` ni `--dangerously-skip-permissions`: no navega ni escribe archivos.

## Pasos

```bash
npm run investigar -- portales   [--jurisdiccion <id>] [--sin-cache]
npm run investigar -- catalogo   [--jurisdiccion <id>] [--max-paginas 2000] [--subir]
npm run investigar -- temas      [--jurisdiccion <id>]
npm run investigar -- clasificar [--jurisdiccion <id>]
npm run investigar -- fichas     [--local <n> | --limite <n>] [--jurisdiccion <id>] [--subir]
```

1. **portales**: lee `data/portales-semilla.json`, descarga cada sitio y usa Gemini para
   encontrar la guía de trámites (hasta 3 saltos, siempre por links de las páginas bajadas).
   Después describe cómo recorrerla. Guarda `data/portales.json` con
   `estado: 'ok' | 'no_encontrado' | 'requiere_js'`.
2. **catalogo**: BFS por portal, acotado al host y al prefijo de la guía. Junta las URLs que
   matchean `regex_fichas` (o las que Gemini clasifica si no hay regex). Guarda
   `data/catalogo/<jurisdiccion_id>.json`. Con `--subir` manda tandas de 500.
3. **temas**: descarga las páginas de categorías y le pide a Gemini la taxonomía de
   `prompts/temas.md` usando solo ese texto. Guarda `data/temas.json`.
4. **clasificar**: asigna `temas_sugeridos` al catálogo, de a 100 entradas por llamada.
5. **fichas**: descarga la ficha y hasta 5 páginas enlazadas relevantes, pide un
   `BorradorFicha` con `prompts/ficha.md`, valida con zod y `chequearBorrador`, y rechaza
   cualquier fuente citada que no hayamos descargado. Guarda
   `data/fichas/<slug>--<jurisdiccion_id>.json`. Con `--local <n>` toma n pendientes del
   catálogo; sin `--local` pide trabajo a `/ingest/v1/trabajo`.

## Descargas

`src/descargar.ts` respeta `robots.txt` (cacheado por host), hace como máximo 1 pedido por
segundo por host y 6 en paralelo, con timeout de 20 s y 2 reintentos ante 5xx o error de red.
Sigue redirecciones a mano (máximo 5) y valida que cada salto siga siendo oficial. Cachea en
`data/paginas/<sha256(url)>.json` durante 7 días; `--sin-cache` la ignora.

Solo se procesan HTML, JSON y texto. Los PDF se marcan y se saltean por ahora.

## Datos y logs

- `data/paginas/`: caché de descargas (ignorada por git).
- `data/log-gemini.jsonl`: una línea por llamada (duración, ok/error, tamaño).
- `data/portales.json`, `data/catalogo/`, `data/temas.json`, `data/fichas/`.

## Tests

```bash
npx vitest run
npx tsc --noEmit
```

Los tests no usan red ni Gemini real: las descargas y el runner se inyectan.
