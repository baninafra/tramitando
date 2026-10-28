#!/usr/bin/env bash
# Recorre el sitio que encontró Gemini (data/sitios/<id>.url) con municipio-local --sitio.
# Qwen 2B clasifica; Qwen 9B entra como escalón si el 2B no saca trámites (como siempre).
# Uso (desde la raíz): bash research/scripts/municipio-sitio.sh <lista.tsv>
# El TSV tiene: id<TAB>nombre<TAB>nivel<TAB>provincia. Saltea los que no tienen .url o ya tienen .ok.
# RENDER=1 para sitios que cargan los trámites con JavaScript (usa --render).
cd "$(dirname "$0")/../.."
lista="$1"
extra=""
[ -n "$RENDER" ] && extra="--render"
salida=research/data/sitios
log=research/data/logs/municipio-sitio.log
mkdir -p "$salida" research/data/logs
echo "== inicio $(date -Iseconds) $lista" >> "$log"
bash research/scripts/qwen-servidor.sh todos >> "$log" 2>&1 || exit 1

while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] && continue
  [ -f "$salida/$id.url" ] || continue
  [ -f "$salida/$id.ok" ] && continue
  url=$(cat "$salida/$id.url")
  timeout 1500 npx tsx research/src/cli.ts municipio-local --jurisdiccion "$id" --nombre "$nombre" \
    --provincia "$provincia" --sitio "$url" --max-paginas 30 $extra > "$salida/$id.local.log" 2>&1
  c=$?
  # 0: trámites nuevos. 2: sitio recorrido sin trámites nuevos. Cualquier otro código: queda pendiente.
  if [ $c -eq 0 ] || [ $c -eq 2 ]; then
    touch "$salida/$id.ok"
    echo "$(date -Iseconds) $id $url · $(grep -o '[0-9]* trámites nuevos' "$salida/$id.local.log" | tail -1)" >> "$log"
  else
    echo "$(date -Iseconds) $id falló (código $c, ver $salida/$id.local.log)" >> "$log"
  fi
done < "$lista"
echo "== fin $(date -Iseconds)" >> "$log"
