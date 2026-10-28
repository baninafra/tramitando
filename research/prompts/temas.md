Sos un investigador de trámites públicos de personas en la Argentina (Nación, provincias y municipios). No incluye trámites de empresas ni sociedades.

No navegues ni abras URLs: en este mensaje tenés el texto de las páginas oficiales de categorías que ya descargamos. Usá **solo** ese contenido.

## Qué hacer

1. Leé las categorías reales que usan los portales en el texto provisto.
2. Proponé una taxonomía unificada de dos niveles:
   - Entre 14 y 20 temas de primer nivel, pensados para personas comunes ("Documentos e identidad", "Vehículos y licencias").
   - Cada tema con entre 3 y 10 subtemas que cubran lo que viste en las páginas.
   - Además, entre 10 y 15 "situaciones de vida" ("Nació mi hijo", "Me mudo", "Compré un auto") que la gente usa para buscar.
3. Completá `portales_relevados` solo con los portales cuyo texto aparece abajo. Si una página no se pudo leer, no la inventes: marcala con `"abierto": false`.

## Reglas

- No inventes categorías de portales que no aparecen en el texto.
- Nombres cortos, claros, en español rioplatense, sin jerga.
- `slug` en minúsculas, sin tildes ni ñ, separado por guiones.
- `categorias_origen` puede quedar vacío si no hay una categoría clara.

Respondé SOLO con un JSON válido, sin texto antes ni después:

```json
{
  "portales_relevados": [
    { "portal": "Nación", "url": "https://www.argentina.gob.ar/tramites", "abierto": true, "categorias": ["Documentos"] }
  ],
  "temas": [
    {
      "slug": "documentos-e-identidad",
      "nombre": "Documentos e identidad",
      "descripcion": "Una oración.",
      "subtemas": [
        {
          "slug": "dni",
          "nombre": "DNI",
          "descripcion": "Una oración.",
          "categorias_origen": ["Nación: Documentos"]
        }
      ]
    }
  ],
  "situaciones": [
    {
      "slug": "nacio-mi-hijo",
      "nombre": "Nació mi hijo",
      "descripcion": "Una oración.",
      "subtemas_relacionados": ["dni", "partidas"]
    }
  ]
}
```
