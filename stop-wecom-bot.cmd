@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = [IO.Path]::GetFullPath('%~dp0');" ^
  "$pidFile = Join-Path $root 'wecom-bot.pid';" ^
  "if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'wecom-bot is not running.'; exit 0 }" ^
  "$targets = New-Object System.Collections.Generic.HashSet[int];" ^
  "$queue = New-Object System.Collections.Generic.Queue[int];" ^
  "try { $queue.Enqueue([int](Get-Content -LiteralPath $pidFile -ErrorAction Stop | Select-Object -First 1)) } catch { Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue; Write-Host 'wecom-bot pid file was invalid and has been cleared.'; exit 0 }" ^
  "while ($queue.Count -gt 0) {" ^
  "  $procId = $queue.Dequeue();" ^
  "  if (-not $targets.Add($procId)) { continue }" ^
  "  Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $procId) | ForEach-Object { $queue.Enqueue([int]$_.ProcessId) };" ^
  "}" ^
  "foreach ($procId in ($targets | Sort-Object -Descending)) { try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host ('stopped PID=' + $procId) } catch {} }" ^
  "Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue;"
