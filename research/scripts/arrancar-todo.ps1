# Arranca research/scripts/arrancar-todo.sh como proceso creado por Windows (WMI), así no queda colgado
# de la terminal ni de la app que lo lanza: si esas se cierran, la generación de fichas sigue.
# Uso: powershell -ExecutionPolicy Bypass -File research\scripts\arrancar-todo.ps1
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bash = 'C:\Program Files\Git\bin\bash.exe'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = "`"$bash`" research/scripts/arrancar-todo.sh"
  CurrentDirectory = $raiz
}
if ($r.ReturnValue -ne 0) { throw "No se pudo arrancar (código $($r.ReturnValue))" }
"Arrancado (PID $($r.ProcessId)). Progreso en research\data\logs\arrancar.log"
