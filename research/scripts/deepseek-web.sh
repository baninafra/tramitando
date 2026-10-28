#!/usr/bin/env bash
# Investigación web con DeepSeek v4.1 (vía opencode, variante low, 10 min por jurisdicción) para una lista.
# Mismo prompt y mismo destino que gemini-web.sh (data/gemini-web/<id>.json y <id>.ok), así
# importar-web.ts los levanta igual. Solo lectura web: research/opencode-web/opencode.json.
# Uso (desde la raíz): bash research/scripts/deepseek-web.sh <lista.tsv>
# El TSV tiene: id<TAB>nombre<TAB>nivel<TAB>provincia.
cd "$(dirname "$0")/../.."
lista="$1"
salida=research/data/gemini-web
log=research/data/logs/deepseek-web.log
mkdir -p "$salida" research/data/logs
echo "== inicio $(date -Iseconds) $lista" >> "$log"

correr() {
  local id="$1" nombre="$2" nivel="$3" provincia="$4"
  [ -f "$salida/$id.ok" ] && return 0
  local prompt
  prompt=$(sed -e "s|{{ID}}|$id|g" -e "s|{{NOMBRE}}|$nombre|g" -e "s|{{NIVEL}}|$nivel|g" -e "s|{{PROVINCIA}}|$provincia|g" \
    research/prompts/web-catalogo.md)

  (cd research/opencode-web && OPENCODE_ENABLE_EXA=1 timeout 600 opencode run -m opencode/deepseek-v4.1-flash-free --variant low "$prompt") \
    > "$salida/$id.json" 2> "$salida/$id.err"
  local codigo=$?
  if [ $codigo -eq 0 ] && grep -q '"tramites"' "$salida/$id.json"; then
    touch "$salida/$id.ok"; echo "$(date -Iseconds) $id deepseek ok" >> "$log"
  else
    echo "$(date -Iseconds) $id deepseek falló (código $codigo, ver $salida/$id.err)" >> "$log"
  fi
}

while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] && continue
  correr "$id" "$nombre" "$nivel" "$provincia" &
  while [ "$(jobs -rp | wc -l)" -ge 2 ]; do sleep 5; done
done < "$lista"
wait
echo "== fin $(date -Iseconds)" >> "$log"
