#!/usr/bin/env bash
# Cola: a medida que la tanda local marca municipios "sin sitio oficial", Gemini busca su sitio
# (gemini-sitio.sh) y Qwen lo recorre (municipio-sitio.sh). Proceso independiente de la sesión.
# Termina cuando la tanda terminó y no quedan municipios nuevos.
# Uso (desde la raíz): bash research/scripts/gemini-sin-sitio.sh
# Los ya vistos van a data/gemini-sin-sitio-vistos.txt: sembrarlo con los sin sitio previos para no repetirlos.
cd "$(dirname "$0")/../.."
data=research/data
log=$data/logs/municipios-local.log
cola=$data/logs/gemini-sin-sitio.log
vistos=$data/gemini-sin-sitio-vistos.txt
mkdir -p "$data/logs"
touch "$vistos"
echo "== inicio $(date -Iseconds)" >> "$cola"

while true; do
  grep "sin sitio oficial ni trámites" "$log" | awk '{print $2}' | sort -u > "$data/.sin-sitio-ahora.txt"
  comm -23 "$data/.sin-sitio-ahora.txt" <(sort -u "$vistos") > "$data/.nuevos.txt"
  n=$(wc -l < "$data/.nuevos.txt")

  if [ "$n" -gt 0 ]; then
    awk -F'\t' 'NR==FNR{ids[$1]=1; next} ($1 in ids)' "$data/.nuevos.txt" "$data/municipios-todos.tsv" > "$data/.nuevos.tsv"
    cat "$data/.nuevos.txt" >> "$vistos"
    echo "$(date -Iseconds) cola: $n municipios nuevos sin sitio, Gemini busca el sitio" >> "$cola"
    bash research/scripts/gemini-sitio.sh "$data/.nuevos.tsv"
    bash research/scripts/municipio-sitio.sh "$data/.nuevos.tsv"
  fi

  # La tanda escribe "== fin" al terminar: con eso y sin nada nuevo, la cola se cierra.
  if [ "$n" -eq 0 ] && tail -n 1 "$log" | grep -q "^== fin"; then break; fi
  sleep 900
done
echo "== fin $(date -Iseconds)" >> "$cola"
