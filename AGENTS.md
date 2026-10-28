# Tramitando — guía para agentes

Tramitando es una web gratuita que explica trámites públicos de la Argentina (Nación, provincias y municipios): qué necesitás, dónde, cuánto cuesta y cuánto tarda. Cada dato tiene una fuente oficial y una fecha de verificación. No hay cuentas de usuario, ni asistente con IA, ni API pública. El código es privado.

## Mapa del repo

| Carpeta | Qué es |
| --- | --- |
| `apps/web` | Web pública en Astro (SSR) sobre Cloudflare Workers |
| `apps/api` | API en Hono sobre Workers: D1, R2, reportes, admin, ingesta, crons |
| `packages/shared` | Esquemas zod y tipos compartidos. **Es el contrato:** no lo cambies sin actualizar la migración y los tests |
| `research` | Pipeline de investigación: descarga páginas oficiales y Gemini las estructura |
| `brand/manual` | Manual de marca: tokens, logos y reglas de voz |
| `docs/arquitectura.md` | Especificación técnica. Leela antes de tocar `apps/api` o `research` |

## Reglas

- **TypeScript estricto**, ESM, sin `any` salvo con un comentario que diga por qué.
- **Nombres del dominio en español** (`tramite`, `variante`, `jurisdiccion`), igual que la base. El código de infraestructura puede ir en inglés.
- **Fuentes oficiales:** toda URL usada como fuente pasa por `esUrlOficial()` de `@tramitando/shared`.
- **Nada se publica sin aprobación:** todo cambio de contenido entra como `borradores` y espera al admin.
- **Mensajes al usuario** en español rioplatense, de vos, cortos y claros (ver `brand/manual/README.md`, sección Voz y tono).
- **Datos personales:** nunca guardar IPs (solo hash con sal) y borrar el email de un reporte al cerrarlo.
- **Tests:** todo endpoint y toda función con lógica lleva test con Vitest. En `apps/api` se usa `@cloudflare/vitest-pool-workers` con D1 real de miniflare y las migraciones aplicadas.
- **Dependencias:** solo las necesarias. Antes de agregar una, fijate si ya hay algo en el repo que lo resuelva.
- **No toques** `apps/web` ni `brand` salvo que la tarea lo pida.
- **Antes de terminar:** `npm run check` y `npm test` en el workspace que tocaste tienen que pasar. No hagas trampa con los tests: no los saltees, no los debilites y no modifiques `node_modules`.

## Comandos

```bash
npm install                      # en la raíz (workspaces)
npm run dev -w @tramitando/api   # API local en :8787 con D1 local
npm run dev -w @tramitando/web   # web local en :4321
npm test -w @tramitando/api
npm run check -w @tramitando/api
```
