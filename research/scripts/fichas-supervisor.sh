#!/usr/bin/env bash
# Supervisa la generación de fichas y reparte la RAM entre el Qwen 4B local y los modelos gratis de opencode
# (cada opencode ocupa ~0,7 GB; el 4B, ~5 GB). Revisa cada 2 minutos:
#   - Modo local: el 4B con 3 tandas fijas y una 4ª si sobra RAM; opencode corre de a 2 turnos.
#   - Modo opencode: si opencode tiene cuota y la RAM no alcanza para todos sus modelos, apaga el 4B y sus
#     tandas (lo que tenían a medias vuelve a la cola a las 6 h) y le da un turno a cada modelo de opencode.
#   - Cuando a todos los de opencode se les termina la cuota, vuelve al modo local.
# Codex y Groq no usan RAM de verdad (corren en la nube) y siguen igual en los dos modos.
# El estado queda en research/data/logs/supervisor-estado.txt para el panel.
# Uso (desde la raíz): nohup bash research/scripts/fichas-supervisor.sh > /dev/null 2>&1 &
cd "$(dirname "$0")/../.."
logs=research/data/logs
log=$logs/supervisor.log
estado=$logs/supervisor-estado.txt
mkdir -p "$logs"
export TRAMITANDO_QWEN_URL=http://127.0.0.1:8646/v1/chat/completions

FIJAS=3
PRENDER_GB=3      # RAM disponible para prender la 4ª tanda local
APAGAR_GB=1       # por debajo de esto se apaga la 4ª
GB_OPENCODE=0.7   # RAM que ocupa cada opencode
TURNOS_LOCAL=2    # turnos de opencode mientras corre el 4B

ram_gb() {
  powershell.exe -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [math]::Round((New-Object Microsoft.VisualBasic.Devices.ComputerInfo).AvailablePhysicalMemory/1GB, 1)" | tr -d '\r' | tr ',' '.'
}
# PIDs de los bucles principales (el subshell de $(...) comparte la línea de comando con su padre).
bucles() { ps -ef | awk -v m="$1" '{ sub(/ +$/, "") } $0 ~ ("bash research/scripts/fichas-todo.sh" m "$") && $3 == 1 {print $2}'; }
descendientes() {
  local hijos
  hijos=$(ps -ef | awk -v p="$1" '$3 == p {print $2}')
  for h in $hijos; do descendientes "$h"; echo "$h"; done
}
matar_arbol() { for p in "$@"; do kill $(descendientes "$p") "$p" 2> /dev/null; done; }
# Modelos de opencode (de nube.conf) que hoy tienen cuota: su bucle no está esperando que se renueve.
opencode_con_cuota() {
  awk '!/^#/ && $2 == "opencode" {print $1}' research/scripts/nube.conf | while read -r n; do
    e=$(cut -d' ' -f1 "$logs/nube-$n.estado" 2> /dev/null)
    [ -n "$e" ] && [ "$e" != esperando-cuota ] && [ "$e" != terminado ] && echo "$n"
  done | wc -l
}
# Fichas que opencode publicó en la última hora. Sin cuota a veces pasa la prueba corta y después se cuelga
# con las fichas de verdad: el 4B solo se apaga si opencode demostró que está publicando.
opencode_publico() {
  local desde nombres
  desde=$(date -d '-60 min' -Iseconds)
  nombres=$(awk '!/^#/ && $2 == "opencode" {printf "%s%s", sep, $1; sep="|"}' research/scripts/nube.conf)
  awk -v d="$desde" -v n="\\[($nombres)\\]   publicada" '$1 >= d && $0 ~ n' "$logs/fichas-nube.log" 2> /dev/null | wc -l
}
MIN_PUBLICADAS=3
local_prendido() { ps -ef | grep -q "[b]ash research/scripts/qwen4b-guardia.sh"; }

apagar_local() {
  matar_arbol $(bucles "") $(bucles " extra")
  matar_arbol $(ps -ef | awk '/bash research\/scripts\/qwen4b-guardia.sh/ && $3 == 1 {print $2}')
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | Where-Object { \$_.CommandLine -match '--port 8646' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" > /dev/null
}
prender_local() {
  (nohup bash research/scripts/qwen4b-guardia.sh > /dev/null 2>&1 &)
  for i in $(seq 1 40); do curl -s -m 3 http://127.0.0.1:8646/health | grep -q '"ok"' && return; sleep 3; done
}

echo "$(date -Iseconds) supervisor arrancó" >> "$log"
while true; do
  ram=$(ram_gb)
  con_cuota=$(opencode_con_cuota)

  if local_prendido; then
    # ¿Opencode tiene cuota y no le alcanza la RAM para correr todos sus modelos? Se apaga el 4B.
    publico=$(opencode_publico)
    falta=$(awk "BEGIN {print ($publico >= $MIN_PUBLICADAS && $con_cuota > $TURNOS_LOCAL && $ram < ($con_cuota - $TURNOS_LOCAL) * $GB_OPENCODE) ? 1 : 0}")
    if [ "$falta" = 1 ]; then
      apagar_local
      touch "$logs/modo-opencode"
      echo "$con_cuota" > "$logs/opencode-turnos.max"
      echo "$(date -Iseconds) opencode publicó $publico en la última hora, $con_cuota con cuota y ${ram} GB libres: se apaga el Qwen 4B local" >> "$log"
      echo "opencode $con_cuota $ram" > "$estado"
      sleep 120
      continue
    fi
    echo "$TURNOS_LOCAL" > "$logs/opencode-turnos.max"
  else
    # Sin cuota, o colgados: si en una hora de modo opencode no publicaron nada, también vuelve el 4B.
    desde_modo=$(( $(date +%s) - $(stat -c %Y "$logs/modo-opencode" 2> /dev/null || date +%s) ))
    if [ "$con_cuota" -eq 0 ] || { [ $desde_modo -ge 3600 ] && [ "$(opencode_publico)" -lt $MIN_PUBLICADAS ]; }; then
      rm -f "$logs/modo-opencode"
      echo "$TURNOS_LOCAL" > "$logs/opencode-turnos.max"
      prender_local
      echo "$(date -Iseconds) opencode sin cuota: vuelve el Qwen 4B local" >> "$log"
    else
      echo "$con_cuota" > "$logs/opencode-turnos.max"
      echo "opencode $con_cuota $ram" > "$estado"
      sleep 120
      continue
    fi
  fi

  # Modo local: tandas fijas y la 4ª según la RAM.
  fijas=$(bucles "" | wc -l)
  while [ "$fijas" -lt $FIJAS ]; do
    (nohup bash research/scripts/fichas-todo.sh > /dev/null 2>&1 &)
    echo "$(date -Iseconds) se relanza una tanda fija" >> "$log"
    fijas=$((fijas + 1))
    sleep 3
  done
  extra=$(bucles " extra")
  if [ -z "$extra" ] && awk "BEGIN {exit !($ram >= $PRENDER_GB)}"; then
    (nohup bash research/scripts/fichas-todo.sh extra > /dev/null 2>&1 &)
    echo "$(date -Iseconds) RAM disponible ${ram} GB: se prende la 4ª tanda" >> "$log"
    extra=prendida
  elif [ -n "$extra" ] && awk "BEGIN {exit !($ram < $APAGAR_GB)}"; then
    matar_arbol $extra
    echo "$(date -Iseconds) RAM disponible ${ram} GB: se apaga la 4ª tanda" >> "$log"
    extra=""
  fi
  echo "local $FIJAS $([ -n "$extra" ] && echo 1 || echo 0) $ram" > "$estado"
  sleep 120
done
