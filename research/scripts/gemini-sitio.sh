#!/usr/bin/env bash
# Gemini 3.8 Flash (Low) busca solo el sitio oficial de cada municipio, sin recorrerlo.
# 1º Gemini vía Antigravity, con permiso total (--yolo) por decisión del usuario.
# 2º Si Gemini se queda sin cuota: DeepSeek v4.1 (free, variante low) vía opencode, solo lectura web.
# Lo que encuentra queda en data/sitios/<id>.url (o <id>.sin-sitio). Después municipio-sitio.sh lo recorre.
# Uso (desde la raíz): bash research/scripts/gemini-sitio.sh <lista.tsv>
# El TSV tiene: id<TAB>nombre<TAB>nivel<TAB>provincia.
cd "$(dirname "$0")/../.."
lista="$1"
salida=research/data/sitios
log=research/data/logs/gemini-sitio.log
mkdir -p "$salida" research/data/logs
echo "== inicio $(date -Iseconds) $lista" >> "$log"

sin_cuota() { grep -qiE "RESOURCE_EXHAUSTED|quota|usage limit|code 429" "$1" 2>/dev/null; }

# Saca la URL oficial del JSON de la respuesta (sobre de agy o texto plano). Vacío si no hay ninguna.
extraer() {
  node -e '
const fs = require("fs");
let t = fs.readFileSync(process.argv[1], "utf8");
try { const s = JSON.parse(t); if (s && typeof s.response === "string") t = s.response; } catch {}
const m = t.match(/"sitio_url"\s*:\s*"(https?:\/\/[^"]+)"/);
console.log(m ? m[1] : "");
' "$1" | grep -E '^https?://([a-z0-9-]+\.)*(gob|gov)\.ar(/|$)' || true
}

# Recorre el sitio apenas Gemini lo encuentra (Qwen 2B, y 9B como escalón). De a uno: Qwen tiene una
# sola ranura por modelo, así que se usa el mismo lock que el respaldo de gemini-web.sh.
recorrer() {
  local id="$1" nombre="$2" nivel="$3" provincia="$4"
  printf '%s\t%s\t%s\t%s\n' "$id" "$nombre" "$nivel" "$provincia" > "$salida/$id.fila.tsv"
  until mkdir research/data/.qwen-lock 2>/dev/null; do sleep 10; done
  bash research/scripts/municipio-sitio.sh "$salida/$id.fila.tsv"
  rmdir research/data/.qwen-lock
}

guardar() {
  local id="$1" url="$2" nombre="$3" nivel="$4" provincia="$5"
  if [ -n "$url" ]; then
    echo "$url" > "$salida/$id.url"; echo "$(date -Iseconds) $id sitio $url" >> "$log"
    recorrer "$id" "$nombre" "$nivel" "$provincia"
  else
    touch "$salida/$id.sin-sitio"; echo "$(date -Iseconds) $id sin sitio oficial" >> "$log"
  fi
}

buscar() {
  local id="$1" nombre="$2" nivel="$3" provincia="$4"
  if [ -f "$salida/$id.url" ] || [ -f "$salida/$id.sin-sitio" ]; then return 0; fi
  local prompt
  prompt=$(sed -e "s|{{ID}}|$id|g" -e "s|{{NOMBRE}}|$nombre|g" -e "s|{{NIVEL}}|$nivel|g" -e "s|{{PROVINCIA}}|$provincia|g" \
    research/prompts/web-sitio.md)

  printf '%s' "$prompt" | agy-delegate -m gemini-3.8-flash-low --yolo --timeout 10m - > "$salida/$id.json" 2> "$salida/$id.err"
  if grep -q '"status":"SUCCESS"' "$salida/$id.json" && ! grep -q '"response":""' "$salida/$id.json"; then
    guardar "$id" "$(extraer "$salida/$id.json")" "$nombre" "$nivel" "$provincia"; return 0
  fi

  if sin_cuota "$salida/$id.err" || sin_cuota "$salida/$id.json"; then
    (cd research/opencode-web && OPENCODE_ENABLE_EXA=1 timeout 600 opencode run -m opencode/deepseek-v4.1-flash-free --variant low "$prompt") \
      > "$salida/$id.json" 2> "$salida/$id.err"
    if [ $? -eq 0 ]; then guardar "$id" "$(extraer "$salida/$id.json")" "$nombre" "$nivel" "$provincia"; return 0; fi
  fi
  echo "$(date -Iseconds) $id sin respuesta usable (ver $salida/$id.err), queda pendiente" >> "$log"
  return 1
}

while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] && continue
  buscar "$id" "$nombre" "$nivel" "$provincia" &
  while [ "$(jobs -rp | wc -l)" -ge 4 ]; do sleep 5; done
done < "$lista"
wait
echo "== fin $(date -Iseconds)" >> "$log"
