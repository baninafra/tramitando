#!/usr/bin/env bash
# Espera a que se renueve la cuota de Gemini, reintenta las jurisdicciones que fallaron,
# importa al catálogo y clasifica en temas lo nuevo. Proceso independiente de la sesión.
# Uso (desde la raíz): bash research/scripts/reintentar.sh <segundos-de-espera>
cd "$(dirname "$0")/../.."
log=research/data/logs/reintentar.log
echo "== espera $1 s desde $(date -Iseconds)" >> "$log"
sleep "$1"
bash research/scripts/gemini-web.sh research/data/jurisdicciones-web.tsv
npx tsx research/src/importar-web.ts >> "$log" 2>&1
for f in research/data/catalogo/*.json; do
  j=$(basename "$f" .json)
  [ "$j" = "nacion" ] && continue
  echo "→ clasificar $j" >> "$log"
  npx tsx research/src/cli.ts clasificar --jurisdiccion "$j" 2>&1 | grep -vE "DEP0|^\s+lote" | tail -1 >> "$log"
done
echo "== fin $(date -Iseconds)" >> "$log"
