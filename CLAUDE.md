@AGENTS.md

## Para Claude

- Claude coordina y verifica. El código del backend lo escriben subagentes con DeepSeek v4.1 vía opencode (`opencode run -m opencode/deepseek-v4.1-flash-free --variant high`) y la investigación la hacen subagentes con Gemini 3.8 Flash Low vía Antigravity (`agy-delegate -m gemini-3.8-flash-low`).
- Dos modos de Gemini: el pipeline `research/src` no navega (recibe texto de páginas oficiales descargadas y devuelve JSON, sin `--yolo`); el relevamiento web `research/scripts/gemini-web.sh` sí navega con `--yolo`, por decisión del usuario, limitado por prompt a dominios `.gob.ar`/`.gov.ar` y filtrado de nuevo al importar (`research/src/importar-web.ts`).
- Respaldo por cuota en el relevamiento web: Gemini 3.8 Flash Low → DeepSeek v4.1 free (variante low, solo lectura web, `research/opencode-web/`) → Qwen 3.5 9B local (`research/scripts/qwen-servidor.sh`, llama-server de UniCore-IA en el puerto 8643; paso `municipio-local`, solo municipios, de a uno por vez).
- Prompts que pasan por `agy-delegate` en Windows no pueden tener comillas invertidas ni `$(...)`: el wrapper los manda a bash dentro de WSL, que los evalúa.
- Nunca confíes en el "listo" de un subagente: corré vos los tests y el chequeo de tipos.
