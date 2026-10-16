@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = [IO.Path]::GetFullPath('%~dp0');" ^
  "$pidFile = Join-Path $root 'wecom-bot.pid';" ^
  "$outLog = Join-Path $root 'wecom-bot.out.log';" ^
  "$errLog = Join-Path $root 'wecom-bot.err.log';" ^
  "if (Test-Path -LiteralPath $pidFile) {" ^
  "  try {" ^
  "    $existingPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction Stop | Select-Object -First 1);" ^
  "    $existing = Get-Process -Id $existingPid -ErrorAction Stop;" ^
  "    Write-Host ('wecom-bot already running, PID=' + $existing.Id);" ^
  "    exit 0;" ^
  "  } catch { Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue; }" ^
  "}" ^
  "Remove-Item -LiteralPath $outLog -ErrorAction SilentlyContinue;" ^
  "Remove-Item -LiteralPath $errLog -ErrorAction SilentlyContinue;" ^
  "$envPath = 'C:\Program Files\nodejs;' + $env:Path;" ^
  "$proc = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @((Join-Path $root 'bin\codex-im.js'), 'wecom-bot') -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden;" ^
  "Set-Content -LiteralPath $pidFile -Value $proc.Id;" ^
  "Write-Host ('wecom-bot started, PID=' + $proc.Id);" ^
  "Write-Host ('stdout log: ' + $outLog);" ^
  "Write-Host ('stderr log: ' + $errLog);"
