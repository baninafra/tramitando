# FichaTramite

Tarjeta de un trámite en resultados de búsqueda y categorías, con lo esencial a la vista: jurisdicción, nombre, costo, plazo y estado de verificación.

- **Contenedor:** `superficie-alta`, borde `borde`, `radio-grande`, `sombra-tarjeta`, relleno `espacio-5`. Toda la tarjeta es un enlace a la ficha completa.
- **Arriba:** chip de jurisdicción (Nación / provincia / municipio · organismo) en `nota` y `tinta-2`.
- **Título:** nombre del trámite en `titulo-3`, en `tinta`, tal como lo busca la gente ("Renovación de DNI", no "Actualización de Documento Nacional de Identidad").
- **Datos:** costo y plazo en dos columnas. Etiqueta en `nota` y `tinta-suave`, valor en `etiqueta` y `tinta`, con cifras tabulares. Si es gratis, escribí "Gratis", no "$ 0".
- **Abajo:** el `Sello` con la fecha de verificación.
- **Lo que pone quien lo usa:** jurisdicción, organismo, nombre, costo, plazo, estado y fecha.
