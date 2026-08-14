#Requires -RunAsAdministrator
<#
  Crea un tunel NOMBRADO de Cloudflare (URL fija) y el config.yml.

  Previo: cloudflared instalado + dominio en la misma cuenta Cloudflare.

  PowerShell (Admin):
    cd ...\iMedicSaaSBack\scripts\tunnel
    copy config.example.cmd config.cmd
    notepad config.cmd
    powershell -ExecutionPolicy Bypass -File .\Setup-NamedTunnel.ps1
#>
$ErrorActionPreference = 'Stop'

function Get-ConfigValue([string]$key) {
  $cfg = Join-Path $PSScriptRoot 'config.cmd'
  if (-not (Test-Path $cfg)) { throw "Copia config.example.cmd a config.cmd y editalo." }
  $line = Select-String -Path $cfg -Pattern "set `"$key=(.+)`"" | Select-Object -Last 1
  if (-not $line) { return '' }
  return $line.Matches[0].Groups[1].Value.Trim()
}

$cf = $null
foreach ($c in @(
    (Join-Path $PSScriptRoot '..\..\cloudflared.exe'),
    'C:\Program Files\cloudflared\cloudflared.exe',
    'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  )) {
  if (Test-Path $c) { $cf = $c; break }
}
if (-not $cf) {
  $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($cmd) { $cf = $cmd.Source }
}
if (-not $cf) { throw 'cloudflared no encontrado. winget install --id Cloudflare.cloudflared -e' }

$name = Get-ConfigValue 'IMEDIC_TUNNEL_NAME'
$hostName = Get-ConfigValue 'IMEDIC_TUNNEL_HOST'
$port = Get-ConfigValue 'IMEDIC_FS_PORT'
if (-not $name) { throw 'IMEDIC_TUNNEL_NAME vacio en config.cmd' }
if (-not $hostName) { throw 'IMEDIC_TUNNEL_HOST vacio en config.cmd' }
if (-not $port) { $port = '9012' }

Write-Host "1) Login Cloudflare (se abre el navegador la primera vez)..."
& $cf tunnel login
if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel login fallo ($LASTEXITCODE)" }

Write-Host "2) Crear tunel '$name' (si ya existe, se ignora)..."
& $cf tunnel create $name 2>$null
& $cf tunnel list

$info = & $cf tunnel list --output json | ConvertFrom-Json
$row = @($info) | Where-Object { $_.name -eq $name } | Select-Object -First 1
if (-not $row) { throw "No se encontro el tunel $name despues de crearlo." }
$uuid = [string]$row.id
$cred = Join-Path $env:USERPROFILE ".cloudflared\$uuid.json"
if (-not (Test-Path $cred)) { throw "No esta el credentials file: $cred" }

$cfgDir = Join-Path $env:USERPROFILE '.cloudflared'
$yml = Join-Path $cfgDir 'config.yml'
@"
tunnel: $uuid
credentials-file: $cred
ingress:
  - hostname: $hostName
    service: http://127.0.0.1:$port
  - service: http_status:404
"@ | Set-Content -Path $yml -Encoding ASCII
Write-Host "3) config.yml escrito en $yml"

Write-Host "4) DNS: $hostName -> tunel $name"
& $cf tunnel route dns $name $hostName
if ($LASTEXITCODE -ne 0) {
  Write-Host "AVISO: route dns fallo. Crea a mano un CNAME $hostName -> $uuid.cfargotunnel.com (proxied)."
}

Write-Host ""
Write-Host "Listo. URL publica: https://$hostName"
Write-Host "Pegala en Super Admin -> empresa -> Conexion -> FileServerUrl"
Write-Host "Luego: wscript.exe `"$PSScriptRoot\start-adjuntos-hidden.vbs`""
