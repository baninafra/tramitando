# Sello

Píldora que muestra qué tan confiable es un dato o una ficha: verificado, en revisión o sin datos.

- **Verificado:** fondo `verificado-fondo`, texto e ícono `verificado`, círculo con check (el sello del logo). Siempre dice la fecha: "Verificado el 14/10/2026".
- **En revisión:** fondo `aviso-fondo`, texto e ícono `aviso`, ícono de reloj. Se usa cuando pasó el plazo de revisión, cuando la fuente oficial cambió o cuando hay un reporte de usuario pendiente: "Puede estar desactualizado".
- **Sin datos:** fondo `superficie`, borde `borde`, texto `tinta-2`. Se usa para municipios que todavía no tienen info: "Sin datos de tu municipio".
- Forma `radio-pildora`, texto en `nota` (13px, 500), relleno `espacio-1` × `espacio-3`.
- Nunca se usa el color solo: cada estado lleva su ícono y su texto.
- **Lo que pone quien lo usa:** el estado y la fecha de la última verificación.
