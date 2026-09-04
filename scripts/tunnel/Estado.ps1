<#
.SYNOPSIS
	Diagnostico de los adjuntos en la PC de una clinica.

.DESCRIPTION
	Muestra el estado del servicio cloudflared, de la tarea del file server y
	si el hostname publico responde. No cambia nada.

	Si algo esta mal, la solucion es volver a correr Instalar-Clinica.ps1:
	es idempotente.

.EXAMPLE
	.\Estado.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$EnvFile  = Join-Path $PSScriptRoot 'clinica.env'
$TaskName = 'iMedic File Server'

function Write-Titulo { param([string]$m) Write-Host "`n$m" -ForegroundColor Cyan }
function Write-Bien   { param([string]$m) Write-Host "  [ok]   $m" -ForegroundColor Green }
function Write-Mal    { param([string]$m) Write-Host "  [mal]  $m" -ForegroundColor Red }
function Write-Dato   { param([string]$m) Write-Host "         $m" -ForegroundColor DarkGray }

# ------------------------------------------------------------- configuracion

Write-Titulo 'Configuracion'
if (-not (Test-Path $EnvFile)) {
	Write-Mal "no existe $EnvFile"
	Write-Dato 'Esta PC no fue instalada. Corre Instalar-Clinica.ps1 como Administrador.'
	exit 1
}

$cfg = @{}
foreach ($linea in Get-Content $EnvFile) {
	if ($linea -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}

$Clinica  = $cfg['IMEDIC_CLINICA']
$Hostname = $cfg['IMEDIC_FS_HOSTNAME']
$Port     = [int]($cfg['IMEDIC_FS_PORT'])
$Root     = $cfg['IMEDIC_FS_ROOT']
$Token    = $cfg['IMEDIC_FS_TOKEN']

Write-Bien "clinica $Clinica"
Write-Dato "hostname   https://$Hostname"
Write-Dato "puerto     127.0.0.1:$Port"
Write-Dato "carpeta    $Root"
Write-Dato "auth       $(if ($Token) { 'token compartido' } else { 'solo tunel' })"

# -------------------------------------------------------------------- disco

Write-Titulo 'Carpeta de adjuntos'
if (Test-Path $Root) {
	$archivos = @(Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue)
	$mb = [math]::Round((($archivos | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
	Write-Bien "$Root existe"
	Write-Dato "$($archivos.Count) archivos, $mb MB"

	$unidad = (Split-Path $Root -Qualifier)
	$vol = Get-PSDrive -Name $unidad.TrimEnd(':') -ErrorAction SilentlyContinue
	if ($vol) {
		Write-Dato "libre en $unidad $([math]::Round($vol.Free / 1GB, 1)) GB"
	}
} else {
	Write-Mal "$Root no existe"
}

# --------------------------------------------------------------- cloudflared

Write-Titulo 'Servicio cloudflared (el tunel)'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if (-not $svc) {
	Write-Mal 'el servicio no esta instalado'
} elseif ($svc.Status -ne 'Running') {
	Write-Mal "el servicio esta $($svc.Status)"
	Write-Dato 'Arrancalo con:  Start-Service cloudflared'
} else {
	Write-Bien "corriendo, arranque $($svc.StartType)"
	if ($svc.StartType -ne 'Automatic') {
		Write-Mal 'no arranca solo al prender la PC'
		Write-Dato 'Arreglalo con:  sc.exe config cloudflared start= auto'
	}
}

$cfgYml = 'C:\ProgramData\Cloudflare\cloudflared\config.yml'
if (Test-Path $cfgYml) {
	Write-Bien "config en $cfgYml"
	$ing = (Select-String -Path $cfgYml -Pattern 'hostname:\s*(.+)$').Matches.Groups[1].Value
	if ($ing -and $ing.Trim() -ne $Hostname) {
		Write-Mal "el config apunta a $ing pero clinica.env dice $Hostname"
	}
} else {
	Write-Mal "falta $cfgYml"
}

# --------------------------------------------------------------- file server

Write-Titulo 'File server (el que guarda en disco)'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
	Write-Mal "no existe la tarea '$TaskName'"
} else {
	$info = Get-ScheduledTaskInfo -TaskName $TaskName
	Write-Bien "tarea $($task.State)"
	Write-Dato "ultima corrida  $($info.LastRunTime) (resultado $($info.LastTaskResult))"
}

$escucha = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($escucha) { Write-Bien "algo escucha en el puerto $Port" }
else { Write-Mal "nadie escucha en el puerto $Port" }

try {
	$h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
	Write-Bien "responde local: root=$($h.root) max=$($h.maxMb)MB auth=$($h.auth)"
} catch {
	Write-Mal "no responde en http://127.0.0.1:$Port/health"
	Write-Dato $_.Exception.Message
	Write-Dato "Reinicialo con:  Start-ScheduledTask -TaskName '$TaskName'"
}

# ------------------------------------------------------------------- publico

Write-Titulo 'Hostname publico (lo que ve el sistema)'
$headers = @{}
if ($Token) { $headers['x-imedic-token'] = $Token }
try {
	$h = Invoke-RestMethod -Uri "https://$Hostname/health" -Headers $headers -TimeoutSec 15
	Write-Bien "https://$Hostname responde (root=$($h.root))"
} catch {
	Write-Mal "https://$Hostname no responde"
	Write-Dato $_.Exception.Message
	Write-Dato 'Si el servicio y el file server estan ok, revisa el DNS en Cloudflare.'
}

Write-Host ''
Write-Host "  En Super Admin, la empresa $Clinica tiene que tener FileServerUrl = https://$Hostname" -ForegroundColor White
Write-Host ''
