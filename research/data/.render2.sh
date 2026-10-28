cd "$(dirname "$0")/../.." || exit 1
log=research/data/logs/reintento-render-2.log
while IFS=$'\t' read -r id url nombre prov; do
  until mkdir research/data/.qwen-lock 2>/dev/null; do sleep 10; done
  echo "== $id $url" >> $log
  timeout 1500 npx tsx research/src/cli.ts municipio-local --jurisdiccion "$id" --nombre "$nombre" --provincia "$prov" --sitio "$url" --max-paginas 30 --render >> $log 2>&1
  echo "codigo $?" >> $log
  rmdir research/data/.qwen-lock
done < research/data/reintento-render-2.tsv
echo "== fin" >> $log
