#!/usr/bin/env bash
# Levanta Qwen local (los modelos de UniCore-IA) con llama-server, si no está corriendo.
# Uso: bash research/scripts/qwen-servidor.sh [2b|9b|embed|todos]   (por defecto: todos)
#   2b → Qwen 3.5 2B en 127.0.0.1:8644 (la mayoría de las clasificaciones)
#   9b → Qwen 3.5 9B en 127.0.0.1:8643 (lo difícil)
# Mismos parámetros de GPU que unicore (src-tauri/src/ia.rs); unicore usa el 8642.
ia="$HOME/UniCore-IA"

levantar() {
  local modelo="$1" puerto="$2" ctx="$3"
  curl -s -m 2 "http://127.0.0.1:$puerto/health" | grep -q ok && return 0
  (cd "$ia/llama" && ./llama-server.exe -m "$modelo" --host 127.0.0.1 --port "$puerto" \
    --fit on --fit-target 768 -c "$ctx" -np 1 -b 2048 -ub 2048 -fa on -ctk q8_0 -ctv q8_0 \
    --jinja --reasoning-format deepseek -t 8 --no-webui --no-mmproj > "$ia/servidor-tramitando-$puerto.log" 2>&1 &)
  for i in $(seq 1 90); do
    curl -s -m 2 "http://127.0.0.1:$puerto/health" | grep -q ok && return 0
    sleep 2
  done
  echo "llama-server no arrancó en $puerto (ver $ia/servidor-tramitando-$puerto.log)"
  return 1
}

# Embeddings para clasificar en temas (Qwen3-Embedding 0.6B): otros flags, sin chat.
levantar_embed() {
  curl -s -m 2 "http://127.0.0.1:8645/health" | grep -q ok && return 0
  (cd "$ia/llama" && ./llama-server.exe -m "$ia/modelos/embed/Qwen3-Embedding-0.6B-Q8_0.gguf" --host 127.0.0.1 --port 8645     --embeddings --pooling last -ngl 99 -c 2048 -np 2 -b 512 -ub 512 -t 4 --no-webui > "$ia/servidor-tramitando-8645.log" 2>&1 &)
  for i in $(seq 1 60); do
    curl -s -m 2 "http://127.0.0.1:8645/health" | grep -q ok && return 0
    sleep 2
  done
  echo "llama-server de embeddings no arrancó en 8645 (ver $ia/servidor-tramitando-8645.log)"
  return 1
}

case "${1:-todos}" in
  2b) levantar "$ia/modelos/2b/Qwen3.5-2B-Q4_K_M.gguf" 8644 8192 ;;
  9b) levantar "$ia/modelos/9b/Qwen3.5-9B-Q4_K_M.gguf" 8643 16384 ;;
  embed) levantar_embed ;;
  todos)
    levantar "$ia/modelos/9b/Qwen3.5-9B-Q4_K_M.gguf" 8643 16384 &&
      levantar "$ia/modelos/2b/Qwen3.5-2B-Q4_K_M.gguf" 8644 8192 &&
      { levantar_embed || true; } ;;  # sin embeddings la clasificación sigue, solo más lenta
esac
