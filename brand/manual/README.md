Tramitando explica cualquier trámite público de la Argentina (de Nación, de provincia o de municipio) en un solo lugar: qué necesitás, dónde se hace, cuánto cuesta y cuánto tarda. La marca tiene que transmitir tres cosas: **claridad** (esto es fácil), **confianza** (la información está chequeada) y **cercanía argentina** (te lo cuenta alguien de acá).

## Esencia

- **Promesa:** "Tu trámite, claro y sin vueltas."
- **Personalidad:** neutral y cercana. Ni oficina pública ni amigo canchero. Pensá en esa persona que ya hizo el trámite y te lo explica con paciencia.
- **Lo que la marca no es:** no es un sitio del Estado. Nunca uses escudos, el Sol de Mayo, la tipografía de argentina.gob.ar ni frases como "sitio oficial". La argentinidad está en el celeste y en cómo hablamos, no en símbolos patrios.

## Logo

El logo une los dos objetos de cualquier trámite: **el papel** (celeste, con la esquina doblada y dos renglones) y **el sello de aprobado** (carbón, con un check). El nombre va siempre en minúscula: `tramitando`.

| Versión | Archivo | Cuándo |
| --- | --- | --- |
| Principal | `tramitando-logo.svg` | Sobre `fondo` claro, `superficie` o `celeste-suave`. Es la versión por defecto. |
| Negativo | `tramitando-logo-negativo.svg` | Sobre `carbon` o cualquier fondo oscuro. |
| Monocromo carbón | `tramitando-logo-mono-carbon.svg` | Sobre `celeste`, impresiones a una tinta, fotocopias. |
| Monocromo blanco | `tramitando-logo-mono-blanco.svg` | Sobre fotos oscuras o fondos de color donde el celeste no contrasta. |
| Isotipo | `tramitando-isotipo.svg` / `-negativo.svg` | Avatar de redes, sellos de verificado, cuando el nombre ya está cerca. |
| Favicon | `tramitando-favicon.svg` | Pestaña del navegador e ícono de acceso directo. |

- **Área de protección:** dejá libre alrededor del logo un espacio igual al diámetro del sello. Nada de texto ni bordes ahí adentro.
- **Tamaño mínimo:** logo completo 112px de ancho en pantalla (25 mm impreso); isotipo 20px; por debajo usá el favicon.
- **Calados:** los renglones, el aro del sello y el check son transparentes. El logo funciona sobre cualquier fondo liso sin cajas detrás.
- **No hagas:** no lo deformes, no lo rotes, no cambies los colores, no le agregues sombra ni contorno, no lo pongas en mayúscula, no separes el sello del papel, no lo apoyes sobre fotos cargadas.

## Color

La paleta es celeste y carbón, con blanco de respiro. La proporción de referencia en una pantalla es **60 % blanco o `superficie`, 30 % `carbon`/`tinta` y 10 % `celeste`**. El celeste es el que se recuerda, pero se usa con medida.

- Usá `celeste` para rellenos grandes: el papel del logo, ilustraciones y bloques de portada. **Nunca uses `celeste` como color de texto sobre blanco** (contraste de 2,4:1). Para enlaces y texto en celeste usá `celeste-tinta`.
- El texto va en `tinta`, `tinta-2` y `tinta-suave`, que cambian solos con el tema. Reservá `carbon` para el logo y para superficies fijas.
- El botón primario es `accion` con texto `on-accion`: carbón en claro, celeste en oscuro.
- Destacá el bloque "Cuánto cuesta" con `celeste-suave` de fondo.
- **Estados de verificación:** `verificado`, `aviso` y `error`, cada uno con su `-fondo`. Siempre van con ícono y texto. El color solo nunca alcanza para distinguirlos.
- Los dos temas (claro y oscuro) son parte de la marca. Todo texto cumple 4,5:1 sobre las superficies que indica su nota.

## Tipografía

Una sola familia: **Figtree** (Google Fonts, licencia libre), una sans humanista, cálida y muy legible. El logotipo usa Figtree Bold convertida en trazos.

- Los títulos usan `display`, `titulo-1`, `titulo-2` y `titulo-3` en peso 700/600. El texto corrido va en `cuerpo` (17px), nunca menos, porque nos leen personas de todas las edades y en celular.
- Los montos van en `monto` con cifras tabulares (`font-variant-numeric: tabular-nums`).
- **Mayúsculas:** escribí como en una oración ("Qué necesitás", no "Qué Necesitás"). Nada de textos enteros en mayúscula.
- **Formatos argentinos:** montos `$ 12.500` (punto de miles, coma decimal, espacio después del signo); fechas `14/10/2026`; horarios `8 a 14 h`.

## Formas, espacio e íconos

- **Formas redondeadas y amables:** `radio-medio` para botones, `radio-grande` para tarjetas y `radio-pildora` para sellos y chips.
- **Una sola sombra:** `sombra-tarjeta`. Para separar el resto, usá `borde` y cambios de superficie.
- **Espaciado** en la escala `espacio-1` a `espacio-8` (base de 4px). Margen lateral mínimo de `espacio-4` en celular.
- **Íconos:** [Lucide](https://lucide.dev), en contorno con trazo de 2px y puntas redondeadas, a 20px junto a texto. Nada de emojis en la interfaz.
- **El sello como motivo:** el círculo con check del logo es el símbolo de "verificado" en toda la web. No lo uses para otra cosa.
- **Foco de teclado:** anillo sólido de 2px en `foco`, separado 2px del elemento. Siempre visible.

## Voz y tono

Hablamos de **vos**, en español rioplatense neutro. Somos claros, directos y amables. Explicamos como alguien que ya hizo el trámite, no como una ventanilla.

- **Primero lo que la persona necesita saber:** cuánto sale, qué llevar, dónde ir. La explicación viene después.
- **Oraciones cortas.** Una idea por oración. Sin jerga ("acreditar identidad" se dice "mostrar tu DNI").
- **Sin promesas que no dependen de nosotros:** "el plazo habitual es de 15 días hábiles", no "te llega en 15 días".
- **Siempre con fuente y fecha:** cada dato muestra de dónde sale y cuándo se verificó.
- **Sin chistes ni exclamaciones en temas sensibles** (defunciones, violencia, salud).

| Sí | No |
| --- | --- |
| Llevá tu DNI anterior, aunque esté vencido. | Se deberá presentar el Documento Nacional de Identidad anterior. |
| Cuesta $ 12.500 si lo hacés en una oficina del RENAPER. | ¡Súper barato! Solo $ 12.500. |
| Verificado el 14/10/2026 en argentina.gob.ar | Información 100 % oficial |
| Esto puede estar desactualizado. Avisanos si cambió. | Error en los datos. |
| ¿Viste algo mal? Mandanos la corrección con una captura o un link. | Reportar incidencia |

**Aviso legal** (va en el pie de todas las páginas): "Tramitando es un sitio independiente y no pertenece a ningún organismo del Estado. Verificá siempre en la fuente oficial antes de hacer tu trámite."

## Componentes

Las fichas de trámite se arman con cuatro piezas: `Boton`, `Sello` (estado de verificación), `FichaTramite` (tarjeta de resultado) y `Checklist` ("Qué necesitás"). Cada una tiene su vista previa y sus reglas en la sección Componentes.
