#!/usr/bin/env bash
# Estado del relevamiento de trámites. Solo lee: no cambia nada.
# Uso (desde la raíz): bash research/scripts/estado.sh
cd "$(dirname "$0")/../data"
L=logs/municipios-local.log
total=$(wc -l < municipios-todos.tsv)
proc=$(grep -c ' muni-' "$L" 2>/dev/null)
echo "Fecha: $(date '+%d/%m/%Y %H:%M')"
echo "Municipios procesados: $proc de $total"
echo "  con trámites: $(grep -c 'trámites nuevos' "$L")"
echo "  sin sitio oficial: $(grep -c 'sin sitio' "$L")"
echo "  usaron Qwen 9B: $(grep -cE 'Qwen 9B [1-9]' "$L")"
echo "Clasificaciones en temas: $(grep -c 'clasificados' "$L")"
if grep -q '== fin' "$L"; then echo "Tanda: TERMINADA"
else
  edad=$(( $(date +%s) - $(date -r "$L" +%s) ))
  # Cada 50 municipios la tanda clasifica en temas con Qwen 9B (~30 min sin escribir en el log).
  clasificando=$(powershell.exe -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'cli.ts clasificar' }).Count" 2>/dev/null | tr -d '\r')
  if [ "$edad" -lt 1800 ]; then echo "Tanda: corriendo (última actividad hace $((edad / 60)) min)"
  elif [ "${clasificando:-0}" -gt 0 ]; then echo "Tanda: corriendo, clasificando en temas con Qwen 9B (pausa normal cada 50 municipios)"
  else echo "Tanda: parece frenada (sin actividad hace $((edad / 60)) min; hay que relanzarla)"; fi
fi
echo "Último municipio: $(grep ' muni-' "$L" | tail -1)"
node -e "
const fs=require('fs');let t=0,m=0,p=0,c=0;
for(const f of fs.readdirSync('catalogo')){const e=JSON.parse(fs.readFileSync('catalogo/'+f,'utf8'));t+=e.length;c+=e.filter(x=>(x.temas_sugeridos||[]).length).length;if(f.startsWith('muni')&&e.length)m++;if(f.startsWith('prov'))p+=e.length}
console.log('Catálogo: '+t+' trámites ('+c+' clasificados en temas), '+m+' municipios con datos');"
for puerto in 8644 8643; do
  curl -s -m 2 "http://127.0.0.1:$puerto/health" | grep -q ok && echo "Qwen en $puerto: ok" || echo "Qwen en $puerto: CAÍDO"
done
