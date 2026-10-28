#!/usr/bin/env bash
# Relevamiento local de municipios, sin cuotas: reglas + Qwen 3.5 2B para la mayoría y
# Qwen 3.5 9B para lo difícil (reintentos, sitios donde el 2B no encontró nada) y para
# clasificar en temas. Proceso independiente de la sesión; se puede cortar y relanzar.
# Uso (desde la raíz): bash research/scripts/municipios-local.sh [lista.tsv]
cd "$(dirname "$0")/../.."
lista="${1:-research/data/municipios-todos.tsv}"
salida=research/data/gemini-web
log=research/data/logs/municipios-local.log
lock=research/data/.clasificar-lock
mkdir -p "$salida" research/data/logs
echo "== inicio $(date -Iseconds) $lista" >> "$log"
bash research/scripts/qwen-servidor.sh todos >> "$log" 2>&1 || exit 1
# Si una corrida anterior se cortó a mitad de clasificar, el lock quedó colgado.
rmdir "$lock" 2>/dev/null

uno() {
  local id="$1" nombre="$2" provincia="$3"
  timeout 1200 npx tsx research/src/cli.ts municipio-local --jurisdiccion "$id" --nombre "$nombre" \
    --provincia "$provincia" --max-paginas 30 > "$salida/$id.local.log" 2>&1
  local c=$?
  if [ $c -eq 0 ]; then
    touch "$salida/$id.ok"
    echo "$(date -Iseconds) $id $(grep -o '[0-9]* trámites nuevos' "$salida/$id.local.log" | tail -1) · $(grep -o 'Qwen 2B [0-9]*, Qwen 9B [0-9]*' "$salida/$id.local.log" | tail -1)" >> "$log"
  else
    touch "$salida/$id.ok" "$salida/$id.sin-sitio"
    echo "$(date -Iseconds) $id sin sitio oficial ni trámites (código $c)" >> "$log"
  fi
}

# Clasifica en temas todo lo pendiente del catálogo (reglas + Qwen 9B). En segundo plano y fuera de
# la lista de jobs, así la tanda sigue recorriendo; si la anterior no terminó, se saltea esta vuelta.
clasificar() {
  mkdir "$lock" 2>/dev/null || return 0
  ( TRAMITANDO_LLM=qwen npx tsx research/src/cli.ts clasificar "$@" >> research/data/logs/clasificar.log 2>&1
    echo "$(date -Iseconds) clasificados en temas los pendientes" >> "$log"
    rmdir "$lock" ) &
  disown
}

hechos=0
while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] || [ -f "$salida/$id.ok" ] && continue
  uno "$id" "$nombre" "$provincia" &
  while [ "$(jobs -rp | wc -l)" -ge 2 ]; do sleep 2; done
  hechos=$((hechos + 1))
  [ $((hechos % 50)) -eq 0 ] && clasificar
done < "$lista"
wait
# Última pasada, ya sin apuro: espera a la que esté corriendo y clasifica lo que quede, también los que
# quedaron con temas vacíos (los viejos de 100 por consulta y los que se guardaron así por error).
while [ -d "$lock" ]; do sleep 10; done
clasificar --rehacer-vacios
while [ -d "$lock" ]; do sleep 10; done
echo "== fin $(date -Iseconds)" >> "$log"
