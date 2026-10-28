#!/usr/bin/env bash
# Genera las fichas de toda la cola de trabajo con Qwen 3.5 9B local y las publica sin revisión manual
# (AUTOPUBLICAR=1, decisión del usuario). De a 20 por vuelta hasta que la cola quede vacía; lo que falla
# vuelve solo a la cola a las pocas horas y se reintenta. Se puede cortar y relanzar.
# Requisitos: la API local corriendo (wrangler dev --persist-to C:/tramitando-estado) con ADMIN_DEV=1.
# Uso (desde la raíz): bash research/scripts/fichas-todo.sh
cd "$(dirname "$0")/../.."
log=research/data/logs/fichas.log
mkdir -p research/data/logs
INGEST_TOKEN="$(grep '^INGEST_TOKEN=' apps/api/.dev.vars | cut -d= -f2- | tr -d '"\r')"
export INGEST_TOKEN AUTOPUBLICAR=1 TRAMITANDO_LLM=qwen
echo "== inicio $(date -Iseconds)" >> "$log"

vacias=0
while true; do
  salida=$(timeout 3600 npx tsx research/src/cli.ts fichas --limite 20 --subir 2>&1)
  echo "$salida" | grep -E '^→|publicada|borradores|descartada|chequeo|error:|Listo' | sed "s/^/$(date -Iseconds) /" >> "$log"
  if echo "$salida" | grep -q 'No hay fichas pendientes'; then
    vacias=$((vacias + 1))
    echo "$(date -Iseconds) la cola no dio trabajo (vez $vacias)" >> "$log"
    # Un vacío suelto puede ser un tropiezo de la API: se reintenta a los 5 min. Las que fallan vuelven a la
    # cola a las 6 h (HORAS_TOMA de la API): después de 3 vacíos seguidos se espera de a 3 h, hasta 9 h.
    [ $vacias -ge 6 ] && break
    if [ $vacias -lt 3 ]; then sleep 300; else sleep 10800; fi
  else
    vacias=0
  fi
done
echo "== fin $(date -Iseconds)" >> "$log"
