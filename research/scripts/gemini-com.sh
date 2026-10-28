#!/usr/bin/env bash
# Para los municipios sin sitio .gob.ar/.gov.ar, Gemini busca un sitio oficial .com, .com.ar o .ar.
# Si lo encuentra, Qwen lo recorre con municipio-local --confirmado: solo se acepta ese host (y sus
# subdominios) en esa corrida. Sin revisión manual. Lo que se encuentra queda en data/sitios/<id>.com
# (o <id>.sin-com si no hay ninguno).
# 1º Gemini 3.8 Flash (Low) vía Antigravity, con --yolo. 2º Si no hay cuota: DeepSeek v4.1 (low).
# Uso (desde la raíz): bash research/scripts/gemini-com.sh <lista.tsv>
# El TSV tiene: id<TAB>nombre<TAB>nivel<TAB>provincia.
cd "$(dirname "$0")/../.."
lista="$1"
salida=research/data/sitios
log=research/data/logs/gemini-com.log
mkdir -p "$salida" research/data/logs
echo "== inicio $(date -Iseconds) $lista" >> "$log"

sin_cuota() { grep -qiE "RESOURCE_EXHAUSTED|quota|usage limit|code 429" "$1" 2>/dev/null; }

# URL del JSON de la respuesta (sobre de agy o texto plano), solo .com, .com.ar o .ar. Vacío si no hay.
extraer() {
  node -e '
const fs = require("fs");
let t = fs.readFileSync(process.argv[1], "utf8");
try { const s = JSON.parse(t); if (s && typeof s.response === "string") t = s.response; } catch {}
const m = t.match(/"sitio_com"\s*:\s*"(https?:\/\/[^"]+)"/);
console.log(m ? m[1] : "");
' "$1" | grep -E '^https?://[^/ ]+\.(com|com\.ar|ar)(/|$)' || true
}

# Qwen recorre el sitio confirmado. Bajo el lock compartido con el resto de los recorridos de Qwen.
recorrer() {
  local id="$1" nombre="$2" provincia="$3" url="$4"
  until mkdir research/data/.qwen-lock 2>/dev/null; do sleep 10; done
  timeout 1500 npx tsx research/src/cli.ts municipio-local --jurisdiccion "$id" --nombre "$nombre" \
    --provincia "$provincia" --sitio "$url" --confirmado --max-paginas 30 > "$salida/$id.com.local.log" 2>&1
  local c=$?
  rmdir research/data/.qwen-lock
  # 0: trámites nuevos. 2: recorrido sin trámites nuevos. Cualquier otro código: queda pendiente.
  if [ $c -eq 0 ] || [ $c -eq 2 ]; then
    touch "$salida/$id.ok"
    echo "$(date -Iseconds) $id recorrido $url · $(grep -o '[0-9]* trámites nuevos' "$salida/$id.com.local.log" | tail -1)" >> "$log"
  else
    echo "$(date -Iseconds) $id recorrido falló (código $c, ver $salida/$id.com.local.log)" >> "$log"
  fi
}

guardar() {
  local id="$1" url="$2" nombre="$3" provincia="$4"
  if [ -n "$url" ]; then
    echo "$url" > "$salida/$id.com"; echo "$(date -Iseconds) $id com $url" >> "$log"
    recorrer "$id" "$nombre" "$provincia" "$url"
  else
    touch "$salida/$id.sin-com"; echo "$(date -Iseconds) $id sin sitio .com" >> "$log"
  fi
}

buscar() {
  local id="$1" nombre="$2" nivel="$3" provincia="$4"
  if [ -f "$salida/$id.com" ] || [ -f "$salida/$id.sin-com" ]; then return 0; fi
  local prompt
  prompt=$(sed -e "s|{{ID}}|$id|g" -e "s|{{NOMBRE}}|$nombre|g" -e "s|{{NIVEL}}|$nivel|g" -e "s|{{PROVINCIA}}|$provincia|g" \
    research/prompts/web-sitio-com.md)

  printf '%s' "$prompt" | agy-delegate -m gemini-3.8-flash-low --yolo --timeout 10m - > "$salida/$id.com.json" 2> "$salida/$id.com.err"
  if grep -q '"status":"SUCCESS"' "$salida/$id.com.json" && ! grep -q '"response":""' "$salida/$id.com.json"; then
    guardar "$id" "$(extraer "$salida/$id.com.json")" "$nombre" "$provincia"; return 0
  fi

  if sin_cuota "$salida/$id.com.err" || sin_cuota "$salida/$id.com.json"; then
    (cd research/opencode-web && OPENCODE_ENABLE_EXA=1 timeout 600 opencode run -m opencode/deepseek-v4.1-flash-free --variant low "$prompt") \
      > "$salida/$id.com.json" 2> "$salida/$id.com.err"
    if [ $? -eq 0 ]; then guardar "$id" "$(extraer "$salida/$id.com.json")" "$nombre" "$provincia"; return 0; fi
  fi
  echo "$(date -Iseconds) $id sin respuesta usable (ver $salida/$id.com.err), queda pendiente" >> "$log"
  return 1
}

while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] && continue
  buscar "$id" "$nombre" "$nivel" "$provincia" &
  while [ "$(jobs -rp | wc -l)" -ge 4 ]; do sleep 5; done
done < "$lista"
wait
echo "== fin $(date -Iseconds)" >> "$log"
