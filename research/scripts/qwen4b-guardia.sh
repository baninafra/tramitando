#!/usr/bin/env bash
# Mantiene vivo el Qwen 3.5 4B de las fichas (puerto 8646): si no hay ninguno corriendo, lo levanta; si hay
# uno colgado (no responde durante 5 minutos seguidos), lo mata y levanta otro. Nunca deja dos a la vez:
# cada copia ocupa VRAM y con varias la GPU se queda sin memoria y ninguna carga.
# 4 consultas a la vez (fichas-todo.sh corre 4 tandas) y sin caché de prompts en RAM (--cache-ram 0):
# con la caché de 8 GB por defecto la RAM se llenaba y el servidor se caía con "bad allocation".
# --load-mode mlock lo fija en RAM: con la memoria justa Windows lo mandaba al disco y bajaba a menos de 1 token/s.
# Uso (desde la raíz): nohup bash research/scripts/qwen4b-guardia.sh > /dev/null 2>&1 &
ia="$HOME/UniCore-IA"
cd "$(dirname "$0")/../.."
log=research/data/logs/qwen4b-guardia.log
mkdir -p research/data/logs

pids4b() {
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | Where-Object { \$_.CommandLine -match '--port 8646' } | ForEach-Object { \$_.ProcessId }" | tr -d '\r'
}
sano() { curl -s -m 5 http://127.0.0.1:8646/health | grep -q '"ok"'; }

sin_respuesta=0
while true; do
  if sano; then
    sin_respuesta=0
  else
    pids=$(pids4b)
    if [ -z "$pids" ]; then
      echo "$(date -Iseconds) no hay 4B corriendo: se levanta" >> "$log"
      (cd "$ia/llama" && ./llama-server.exe -m "$ia/modelos/4b/Qwen3.5-4B-Q4_K_M.gguf" --host 127.0.0.1 --port 8646 \
        --fit off -ngl 99 -c 65536 -np 4 -b 1024 -ub 512 -fa on -ctk q8_0 -ctv q8_0 --cache-ram 0 --load-mode mlock \
        --jinja --reasoning-format deepseek -t 8 --no-webui --no-mmproj >> "$ia/servidor-tramitando-8646.log" 2>&1 &)
      sin_respuesta=0
    else
      sin_respuesta=$((sin_respuesta + 1))
      # 10 vueltas de 30 s = 5 minutos sin responder (cargar tarda menos de 1 minuto).
      if [ $sin_respuesta -ge 10 ]; then
        echo "$(date -Iseconds) el 4B ($pids) no responde hace 5 min: se mata" >> "$log"
        for p in $pids; do taskkill //PID "$p" //F > /dev/null 2>&1; done
        sin_respuesta=0
      fi
    fi
  fi
  sleep 30
done
