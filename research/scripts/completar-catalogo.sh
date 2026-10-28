#!/usr/bin/env bash
# Corrida larga e independiente de la sesión: termina el catálogo y lo clasifica en temas.
# Uso (desde la raíz del repo): bash research/scripts/completar-catalogo.sh
# Avance en research/data/logs/completar-catalogo.log
cd "$(dirname "$0")/../.."
mkdir -p research/data/logs
log=research/data/logs/completar-catalogo.log
echo "== inicio $(date -Iseconds)" >> "$log"

for j in prov-70 prov-26; do
  npx tsx research/src/cli.ts catalogo --jurisdiccion "$j" --render --max-paginas 250 2>&1 \
    | grep -E "^→|redirige|sitemap:|fichas:|error" >> "$log"
done

for j in prov-02 prov-06 prov-22 prov-26 prov-34 prov-38 prov-42 prov-70 prov-74 prov-82 prov-86 prov-90; do
  echo "→ clasificar $j" >> "$log"
  npx tsx research/src/cli.ts clasificar --jurisdiccion "$j" 2>&1 | grep -vE "DEP0|^\s+lote" | tail -2 >> "$log"
done

echo "== fin $(date -Iseconds)" >> "$log"
