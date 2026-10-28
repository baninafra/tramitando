#!/usr/bin/env bash
# Investigación web: un agente por jurisdicción, 4 en paralelo.
# 1º Gemini 3.8 Flash (Low) vía Antigravity, con permiso total (--yolo) por decisión del usuario.
# 2º Si Gemini se queda sin cuota: DeepSeek v4.1 (free, variante low) vía opencode, con solo
#    lectura web (research/opencode-web/opencode.json: sin edición ni comandos).
# El prompt limita las fuentes a .gob.ar / .gov.ar y la importación vuelve a filtrar con esUrlOficial.
# Uso (desde la raíz): bash research/scripts/gemini-web.sh <lista.tsv>
# El TSV tiene: id<TAB>nombre<TAB>nivel<TAB>provincia. Cada respuesta buena deja <id>.ok.
cd "$(dirname "$0")/../.."
raiz=$(pwd)
lista="$1"
salida=research/data/gemini-web
mkdir -p "$salida" research/data/logs
log=research/data/logs/gemini-web.log
echo "== inicio $(date -Iseconds) $lista" >> "$log"

sin_cuota() { grep -qiE "RESOURCE_EXHAUSTED|quota|usage limit|code 429" "$1" 2>/dev/null; }

correr() {
  local id="$1" nombre="$2" nivel="$3" provincia="$4"
  [ -f "$salida/$id.ok" ] && return 0
  local prompt
  prompt=$(sed -e "s|{{ID}}|$id|g" -e "s|{{NOMBRE}}|$nombre|g" -e "s|{{NIVEL}}|$nivel|g" -e "s|{{PROVINCIA}}|$provincia|g" \
    research/prompts/web-catalogo.md)

  printf '%s' "$prompt" | agy-delegate -m gemini-3.8-flash-low --yolo --timeout 25m - > "$salida/$id.json" 2> "$salida/$id.err"
  if grep -q '"status":"SUCCESS"' "$salida/$id.json" && ! grep -q '"response":""' "$salida/$id.json"; then
    touch "$salida/$id.ok"; echo "$(date -Iseconds) $id gemini ok" >> "$log"; return 0
  fi

  if sin_cuota "$salida/$id.err" || sin_cuota "$salida/$id.json"; then
    (cd research/opencode-web && OPENCODE_ENABLE_EXA=1 timeout 900 opencode run -m opencode/deepseek-v4.1-flash-free --variant low "$prompt") \
      > "$salida/$id.json" 2> "$salida/$id.err"
    local codigo=$?
    if [ $codigo -eq 0 ] && grep -q '"tramites"' "$salida/$id.json"; then
      touch "$salida/$id.ok"; echo "$(date -Iseconds) $id deepseek ok" >> "$log"; return 0
    fi
    # 3º Sin cuota en ninguno: Qwen 3.5 9B local. Solo municipios (busca el sitio oficial por
    # direcciones típicas y lo recorre). De a uno por vez: usa la placa de video.
    if [ "$nivel" = "municipio" ]; then
      until mkdir research/data/.qwen-lock 2>/dev/null; do sleep 10; done
      bash research/scripts/qwen-servidor.sh >> "$log" 2>&1
      TRAMITANDO_LLM=qwen timeout 1500 npx tsx research/src/cli.ts municipio-local \
        --jurisdiccion "$id" --nombre "$nombre" --provincia "$provincia" --max-paginas 30 \
        > "$salida/$id.qwen.log" 2>&1
      local cq=$?
      rmdir research/data/.qwen-lock
      if [ $cq -eq 0 ]; then
        touch "$salida/$id.ok" "$salida/$id.qwen"; echo "$(date -Iseconds) $id qwen ok" >> "$log"; return 0
      fi
      touch "$salida/$id.ok" "$salida/$id.sin-sitio"
      echo "$(date -Iseconds) $id qwen: no encontró sitio oficial ni trámites" >> "$log"
      return 1
    fi
    echo "$(date -Iseconds) $id sin cuota en Gemini ni en DeepSeek (queda pendiente)" >> "$log"
    return 1
  fi
  echo "$(date -Iseconds) $id falló (ver $salida/$id.err)" >> "$log"
  return 1
}

while IFS=$'\t' read -r id nombre nivel provincia; do
  [ -z "$id" ] && continue
  correr "$id" "$nombre" "$nivel" "$provincia" &
  while [ "$(jobs -rp | wc -l)" -ge 4 ]; do sleep 5; done
done < "$lista"
wait
echo "== fin $(date -Iseconds)" >> "$log"
