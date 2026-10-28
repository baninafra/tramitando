#!/usr/bin/env bash
# Levanta todo lo de la generación de fichas, solo lo que no esté corriendo: API (8787), web (4321),
# panel (4500), guardia del Qwen 4B (8646), supervisor de las tandas y DeepSeek. Se puede correr las
# veces que haga falta. Para que nada dependa de la terminal o de la app que lo lanza, conviene
# arrancarlo con research/scripts/arrancar-todo.ps1 (lo crea Windows, fuera de ese árbol de procesos).
cd "$(dirname "$0")/../.."
estado_dir=C:/tramitando-estado
panel="/c/Users/fbani/claude code/tramitando"
log=research/data/logs/arrancar.log
mkdir -p research/data/logs

responde() { curl -s -m 5 -o /dev/null "$1"; }
corre() { ps -ef | grep -q "[b]ash research/scripts/$1"; }

echo "$(date -Iseconds) arranque" >> "$log"
if ! responde http://127.0.0.1:8787/v1/temas; then
  (cd apps/api && nohup npx wrangler dev --port 8787 --persist-to "$estado_dir" >> "$estado_dir/api.log" 2>&1 &)
  echo "$(date -Iseconds) API" >> "$log"
fi
if ! responde http://localhost:4321/; then
  (nohup npm run dev -w @tramitando/web >> "$estado_dir/web.log" 2>&1 &)
  echo "$(date -Iseconds) web" >> "$log"
fi
if ! responde http://127.0.0.1:4500/; then
  (cd "$panel" && nohup node server.mjs >> server.log 2>&1 &)
  echo "$(date -Iseconds) panel" >> "$log"
fi
corre qwen4b-guardia.sh || { (nohup bash research/scripts/qwen4b-guardia.sh > /dev/null 2>&1 &); echo "$(date -Iseconds) guardia 4B" >> "$log"; }

# Las tandas necesitan la API y el 4B.
for i in $(seq 1 60); do
  responde http://127.0.0.1:8787/v1/temas && curl -s -m 3 http://127.0.0.1:8646/health | grep -q '"ok"' && break
  sleep 5
done
corre fichas-supervisor.sh || { (nohup bash research/scripts/fichas-supervisor.sh > /dev/null 2>&1 &); echo "$(date -Iseconds) supervisor" >> "$log"; }
# Un bucle por cada modelo gratis en la nube de research/scripts/nube.conf.
while read -r nombre llm modelo; do
  case "$nombre" in ''|\#*) continue ;; esac
  corre "fichas-nube.sh $nombre " || {
    (nohup bash research/scripts/fichas-nube.sh "$nombre" "$llm" "$modelo" > /dev/null 2>&1 &)
    echo "$(date -Iseconds) nube $nombre" >> "$log"
    sleep 2
  }
done < research/scripts/nube.conf
