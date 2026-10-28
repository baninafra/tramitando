#!/usr/bin/env bash
# Genera fichas con un modelo gratis en la nube, en paralelo al Qwen 4B local, y las publica sin revisión
# manual (AUTOPUBLICAR=1, decisión del usuario). De a 20 por vuelta, de la misma cola de la API.
# Si una tanda falla entera o el error habla de cuota, espera: los de opencode hasta las 00:05 UTC (su cuota
# gratis se renueva a las 00:00 UTC, 21:00 en la Argentina); el resto, ESPERA segundos y vuelve a probar.
# Estado para el panel en research/data/logs/nube-<nombre>.estado. Se puede cortar y relanzar.
#
# Uso (desde la raíz): bash research/scripts/fichas-nube.sh <nombre> <llm> [modelo]
#   llm: opencode | codex | groq | openrouter     (modelo opcional: el de opencode/openrouter/groq/codex)
# Las claves de Groq y OpenRouter se leen de C:/tramitando-estado/claves.env (fuera del repo).
cd "$(dirname "$0")/../.."
nombre="$1"; llm="$2"; modelo="${3:-}"
log=research/data/logs/fichas-nube.log
estado=research/data/logs/nube-$nombre.estado
mkdir -p research/data/logs
[ -f C:/tramitando-estado/claves.env ] && { set -a; . C:/tramitando-estado/claves.env; set +a; }
INGEST_TOKEN="$(grep '^INGEST_TOKEN=' apps/api/.dev.vars | cut -d= -f2- | tr -d '"\r')"
export INGEST_TOKEN AUTOPUBLICAR=1 TRAMITANDO_LLM="$llm"
case "$llm" in
  opencode) export TRAMITANDO_OPENCODE_MODELO="$modelo"; ESPERA=utc ;;
  codex) [ -n "$modelo" ] && export TRAMITANDO_CODEX_MODELO="$modelo"; ESPERA=1800 ;;
  groq) [ -n "$modelo" ] && export TRAMITANDO_GROQ_MODELO="$modelo"; ESPERA=300 ;;
  openrouter) export TRAMITANDO_OPENROUTER_MODELO="$modelo"; ESPERA=1800 ;;
  *) echo "llm desconocido: $llm"; exit 1 ;;
esac
echo "$(date -Iseconds) [$nombre] inicio ($llm $modelo)" >> "$log"

# Cada opencode ocupa ~0,7 GB de RAM: corren a lo sumo N tandas de opencode a la vez. N lo ajusta el
# supervisor en research/data/logs/opencode-turnos.max (más turnos cuando apaga el Qwen local).
turnos=research/data/logs/opencode-turnos
mkdir -p "$turnos"
turno=""
tomar_turno() {
  while true; do
    max=$(cat "$turnos.max" 2> /dev/null || echo 2)
    for s in $(seq 1 "$max"); do
      if mkdir "$turnos/$s" 2> /dev/null; then echo $$ > "$turnos/$s/pid"; turno=$s; return; fi
      # Turno de un bucle que ya no existe: se libera.
      p=$(cat "$turnos/$s/pid" 2> /dev/null)
      [ -n "$p" ] && ! kill -0 "$p" 2> /dev/null && rm -rf "$turnos/$s"
    done
    echo "esperando-turno" > "$estado"
    sleep 30
  done
}
soltar_turno() { [ -n "$turno" ] && rm -rf "$turnos/$turno"; turno=""; }
trap soltar_turno EXIT
# Prueba corta antes de cada tanda: sin cuota, opencode se cuelga en vez de dar error.
opencode_responde() {
  (cd research/opencode-fichas && timeout 90 opencode run "Respondé solo la palabra ok" -m "$modelo" --variant low 2> /dev/null) | grep -qi ok
}
esperar_cuota() {
  local ahora hasta
  ahora=$(date -u +%s)
  if [ "$ESPERA" = utc ]; then hasta=$(( (ahora / 86400 + 1) * 86400 + 300 )); else hasta=$(( ahora + ESPERA )); fi
  echo "$(date -Iseconds) [$nombre] sin cuota ($1): espera hasta $(date -d "@$hasta" -Iseconds)" >> "$log"
  echo "esperando-cuota $hasta" > "$estado"
  sleep $(( hasta - ahora ))
}

vacias=0
while true; do
  if [ "$llm" = opencode ]; then
    tomar_turno
    if ! opencode_responde; then soltar_turno; esperar_cuota "no respondió la prueba"; continue; fi
  fi
  echo "corriendo" > "$estado"
  salida=$(timeout 3600 npx tsx research/src/cli.ts fichas --limite 20 --subir 2>&1 | grep -vE 'DEP0190|trace-deprecation')
  soltar_turno
  echo "$salida" | grep -E '^→|publicada|borradores|descartada|chequeo|error:|Listo' | sed "s/^/$(date -Iseconds) [$nombre] /" >> "$log"

  if echo "$salida" | grep -q 'No hay fichas pendientes'; then
    vacias=$((vacias + 1))
    [ $vacias -ge 6 ] && break
    echo "cola-vacia $(( $(date +%s) + 1800 ))" > "$estado"
    sleep 1800
    continue
  fi
  vacias=0

  hechas=$(echo "$salida" | grep -cE 'publicada|borradores|descartada')
  errores=$(echo "$salida" | grep -c 'error:')
  # Solo en las líneas de error: hay trámites que se llaman "cuota" (p. ej. cuota alimentaria).
  if echo "$salida" | grep 'error:' | grep -qiE 'sin cuota|quota|rate.?limit|\b429\b|too many requests|usage limit|exceeded' || { [ "$hechas" -eq 0 ] && [ "$errores" -ge 3 ]; }; then
    esperar_cuota "$errores errores, $hechas hechas"
  fi
done
echo "terminado" > "$estado"
echo "$(date -Iseconds) [$nombre] fin" >> "$log"
