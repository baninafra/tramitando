#!/usr/bin/env bash
# Recorre los municipios que la tanda marcó "sin sitio" pero que tienen un sitio .gob.ar/.gov.ar en las
# fuentes oficiales (ReFeGLo, gba.gob.ar; ver `cli.ts sitios-oficiales`). municipio-local lo toma solo de
# data/sitios-oficiales.tsv. De a uno, para no pelearle Qwen a la tanda.
# Uso (desde la raíz): bash research/scripts/sitios-oficiales.sh [lista.tsv]
cd "$(dirname "$0")/../.."
lista="${1:-research/data/sin-sitio-con-oficial.tsv}"
salida=research/data/gemini-web
log=research/data/logs/sitios-oficiales.log
mkdir -p research/data/logs
echo "== inicio $(date -Iseconds) $lista" >> "$log"

while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] || [ -f "$salida/$id.oficial-ok" ] && continue
  timeout 1200 npx tsx research/src/cli.ts municipio-local --jurisdiccion "$id" --nombre "$nombre" \
    --provincia "$provincia" --max-paginas 30 > "$salida/$id.oficial.log" 2>&1
  c=$?
  touch "$salida/$id.oficial-ok"
  if [ $c -eq 0 ]; then
    rm -f "$salida/$id.sin-sitio"
    echo "$(date -Iseconds) $id $(grep -o 'sitio http[^ ]*' "$salida/$id.oficial.log" | head -1) · $(grep -o '[0-9]* trámites nuevos' "$salida/$id.oficial.log" | tail -1)" >> "$log"
  else
    echo "$(date -Iseconds) $id sin trámites tampoco con el sitio oficial (código $c)" >> "$log"
  fi
done < "$lista"
echo "== fin $(date -Iseconds)" >> "$log"
