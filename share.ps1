# 续禾杀：启动服务器 + Cloudflare 临时隧道 + 打印公网地址（Windows）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { '8787' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host '没找到 Node.js，请先安装：https://nodejs.org （选 LTS 版），装完重新双击 share.bat' -ForegroundColor Red; exit 1 }
$v = (node -v).TrimStart('v').Split('.') | ForEach-Object { [int]$_ }
if ($v[0] -lt 22 -or ($v[0] -eq 22 -and $v[1] -lt 18)) { Write-Host "Node.js 版本太旧（$(node -v)），请到 https://nodejs.org 装最新的 LTS 版" -ForegroundColor Red; exit 1 }
$cf = Join-Path $PSScriptRoot 'tools\cloudflared.exe'
if (-not (Test-Path $cf)) {
  Write-Host '第一次运行，下载 cloudflared…'
  New-Item -ItemType Directory -Force tools | Out-Null
  Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf
}
if (-not (Test-Path 'server\node_modules')) { Write-Host '第一次运行，安装依赖（npm install）…'; Push-Location server; npm install --omit=dev --no-audit --no-fund; Pop-Location; if ($LASTEXITCODE -ne 0) { Write-Host 'npm install 失败，检查网络后重试' -ForegroundColor Red; exit 1 } }
$env:PORT = $port
$srv = Start-Process node -ArgumentList 'server\src\main.ts' -NoNewWindow -PassThru
$log = Join-Path $env:TEMP 'xuhesha-tunnel.log'
$proto = if ($env:CF_PROTOCOL) { $env:CF_PROTOCOL } else { 'auto' }
Remove-Item $log -ErrorAction SilentlyContinue
$tun = Start-Process $cf -ArgumentList "tunnel --no-autoupdate --protocol $proto --url http://127.0.0.1:$port" -NoNewWindow -PassThru -RedirectStandardError $log
try {
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) { Start-Sleep 1; if (Test-Path $log) { $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } } }
  if (-not $url) { Write-Host '隧道没起来，日志：'; Get-Content $log; Read-Host '按回车退出'; exit 1 }
  $bar = '#' * 72
  Write-Host ''; Write-Host $bar -ForegroundColor Yellow; Write-Host ''
  Write-Host '      把下面这个地址发给朋友：' -ForegroundColor Yellow; Write-Host ''
  Write-Host "      $url" -ForegroundColor Black -BackgroundColor Yellow; Write-Host ''
  Write-Host '      （已经复制到剪贴板，直接粘贴就行）' -ForegroundColor Yellow; Write-Host ''
  Write-Host $bar -ForegroundColor Yellow; Write-Host ''
  Write-Host '你自己也打开这个地址：一人点「建房」，另一人输房间号加入。'
  Write-Host '等 10～20 秒地址才能打开。关掉这个窗口，游戏就停了。'
  try { Set-Clipboard $url } catch {}
  Wait-Process -Id $srv.Id
} finally { Stop-Process -Id $tun.Id -ErrorAction SilentlyContinue; Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue }
