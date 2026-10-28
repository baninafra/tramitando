#!/usr/bin/env bash
# Genera fichas con DeepSeek v4.1 free (opencode) en paralelo al Qwen 4B local, y las publica sin revisión
# manual (AUTOPUBLICAR=1, decisión del usuario). De a 20 por vuelta, tomadas de la misma cola de la API.
# La cuota gratis de opencode se renueva todos los días a las 00:00 UTC (21:00 en la Argentina): si una
# tanda falla entera o el error habla de cuota, espera hasta 5 minutos después de ese horario y sigue.
# El estado queda en research/data/logs/deepseek-estado.txt para el panel. Se puede cortar y relanzar.
# Uso (desde la raíz): bash research/scripts/fichas-deepseek.sh
cd "$(dirname "$0")/../.."
log=research/data/logs/fichas-deepseek.log
estado=research/data/logs/deepseek-estado.txt
mkdir -p research/data/logs
INGEST_TOKEN="$(grep '^INGEST_TOKEN=' apps/api/.dev.vars | cut -d= -f2- | tr -d '"\r')"
export INGEST_TOKEN AUTOPUBLICAR=1 TRAMITANDO_LLM=deepseek
echo "== inicio $(date -Iseconds)" >> "$log"

vacias=0
while true; do
  echo "corriendo" > "$estado"
  salida=$(timeout 3600 npx tsx research/src/cli.ts fichas --limite 20 --subir 2>&1 | grep -vE 'DEP0190|trace-deprecation')
  echo "$salida" | grep -E '^→|publicada|borradores|descartada|chequeo|error:|Listo' | sed "s/^/$(date -Iseconds) /" >> "$log"

  if echo "$salida" | grep -q 'No hay fichas pendientes'; then
    vacias=$((vacias + 1))
    [ $vacias -ge 4 ] && break
    echo "cola-vacia $(( $(date +%s) + 10800 ))" > "$estado"
    sleep 10800
    continue
  fi
  vacias=0

  hechas=$(echo "$salida" | grep -cE 'publicada|borradores|descartada')
  errores=$(echo "$salida" | grep -c 'error:')
  # Solo en las líneas de error: hay trámites que se llaman "cuota" (p. ej. cuota alimentaria).
  if echo "$salida" | grep 'error:' | grep -qiE 'quota|rate.?limit|\b429\b|too many requests|usage limit|exceeded' ||{ [ "$hechas" -eq 0 ] && [ "$errores" -ge 3 ]; }; then
    ahora=$(date -u +%s)
    hasta=$(( (ahora / 86400 + 1) * 86400 + 300 ))  # 00:05 UTC del día siguiente
    echo "$(date -Iseconds) sin cuota de DeepSeek ($errores errores, $hechas hechas): espera hasta $(date -d "@$hasta" -Iseconds)" >> "$log"
    echo "esperando-cuota $hasta" > "$estado"
    sleep $(( hasta - ahora ))
  fi
done
echo "terminado" > "$estado"
echo "== fin $(date -Iseconds)" >> "$log"
