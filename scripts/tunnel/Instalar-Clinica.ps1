<#
.SYNOPSIS
	Deja la PC de una clinica publicando sus adjuntos en un hostname fijo.

.DESCRIPTION
	Se corre UNA vez por clinica, como Administrador, y no es interactivo.
	Instala dos cosas como servicios de Windows:

	  1. cloudflared, conectado al tunel de esa clinica. El tunel y su hostname
	     (files-<clinica>.imedic.com.ar) ya fueron creados por API desde el
	     repo, con:  node scripts/cloudflare/cf-setup.js clinica <slug> --aplicar
	     Ese comando imprime el -TunnelToken que hay que pasar aca.
	  2. El file server de adjuntos, escuchando solo en 127.0.0.1.

	El tunel es "administrado por Cloudflare": la configuracion del ingress
	vive en Cloudflare, no en esta PC. Por eso aca no hay login por navegador,
	ni cert.pem, ni config.yml que se desincronice.

	No hay Quick Tunnels ni URLs de trycloudflare.com. Si la PC se reinicia,
	los dos servicios vuelven solos y el hostname es el mismo de siempre.

	Es idempotente: se puede volver a correr para reparar la instalacion.

.PARAMETER Clinica
	Slug de la clinica en minusculas (vidal, sarmiento). Tiene que ser el
	mismo que se uso en cf-setup.js.

.PARAMETER TunnelToken
	Token del tunel que imprimio cf-setup.js. Es una credencial: no lo
	commitees ni lo pegues en un chat.

.PARAMETER Root
	Carpeta donde se guardan los adjuntos en el disco de la clinica.

.PARAMETER Port
	Puerto local del file server. Solo escucha en loopback.

.PARAMETER Token
	Opcional. Secreto compartido que el file server exige en el header
	x-imedic-token. Tiene que coincidir con FILE_SERVER_TOKEN del backend.

.EXAMPLE
	.\Instalar-Clinica.ps1 -Clinica vidal -Root "E:\adjuntos" -TunnelToken "eyJhIjoi..."
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
	[string]$Clinica,

	[Parameter(Mandatory = $true)]
	[string]$TunnelToken,

	[string]$Root = 'E:\adjuntos',

	[int]$Port = 9012,

	[string]$Token = '',

	[string]$Dominio = 'imedic.com.ar'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Hostname     = "files-$Clinica.$Dominio"
$RepoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$FileServerJs = Join-Path $RepoRoot 'file-server.js'
$EnvFile      = Join-Path $PSScriptRoot 'clinica.env'
$TaskName     = 'iMedic File Server'

function Write-Paso { param([string]$m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    !   $m" -ForegroundColor Yellow }

function Assert-Admin {
	$id = [Security.Principal.WindowsIdentity]::GetCurrent()
	$pr = New-Object Security.Principal.WindowsPrincipal($id)
	if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
		throw 'Hay que correr este script como Administrador (click derecho > Ejecutar como administrador).'
	}
}

function Get-CloudflaredPath {
	$cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	foreach ($p in @(
		"$env:ProgramFiles\cloudflared\cloudflared.exe",
		"${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
		"$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
	)) {
		if (Test-Path $p) { return $p }
	}
	return $null
}

function Install-Cloudflared {
	$exe = Get-CloudflaredPath
	if ($exe) {
		Write-Ok "cloudflared ya instalado: $exe"
		return $exe
	}

	Write-Warn 'cloudflared no esta instalado, bajandolo...'
	$dir = "$env:ProgramFiles\cloudflared"
	New-Item -ItemType Directory -Force -Path $dir | Out-Null
	$exe = Join-Path $dir 'cloudflared.exe'
	$url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing

	# Que quede en el PATH de la maquina para poder diagnosticar despues.
	$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
	if ($machinePath -notlike "*$dir*") {
		[Environment]::SetEnvironmentVariable('Path', "$machinePath;$dir", 'Machine')
	}
	$env:Path = "$env:Path;$dir"

	Write-Ok "cloudflared instalado en $exe"
	return $exe
}

function Get-NodePath {
	$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
		if (Test-Path $p) { return $p }
	}
	throw 'Falta Node.js. Instalalo desde https://nodejs.org (LTS) y volve a correr este script.'
}

# ---------------------------------------------------------------- verificacion

Assert-Admin

Write-Host ''
Write-Host '  Instalacion de adjuntos iMedic' -ForegroundColor White
Write-Host "  clinica:   $Clinica"
Write-Host "  hostname:  https://$Hostname"
Write-Host "  carpeta:   $Root"
Write-Host "  puerto:    127.0.0.1:$Port"
Write-Host "  auth:      $(if ($Token) { 'token compartido' } else { 'solo tunel' })"

if (-not (Test-Path $FileServerJs)) {
	throw "No encuentro file-server.js en $RepoRoot. Corre el script desde el repo iMedicSaaSBack."
}

Write-Paso 'Dependencias'
$Cloudflared = Install-Cloudflared
$Node = Get-NodePath
Write-Ok "node: $Node"

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules\express'))) {
	Write-Warn 'Faltan dependencias de node, corriendo npm install --omit=dev...'
	Push-Location $RepoRoot
	try { & npm install --omit=dev | Out-Host }
	finally { Pop-Location }
}
Write-Ok 'dependencias de node listas'

New-Item -ItemType Directory -Force -Path $Root | Out-Null
Write-Ok "carpeta de adjuntos: $Root"

# --------------------------------------------------------- servicio del tunel

Write-Paso 'Servicio de cloudflared'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
	Write-Warn 'ya existia el servicio, reinstalandolo con el token nuevo...'
	& $Cloudflared service uninstall 2>&1 | Out-Null
	Start-Sleep -Seconds 2
}

# Con el token, cloudflared se registra como servicio y baja la config del
# ingress desde Cloudflare. No usa config.yml ni cert.pem.
& $Cloudflared service install $TunnelToken 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
	throw 'No se pudo instalar el servicio de cloudflared. Revisa que el -TunnelToken sea el que imprimio cf-setup.js.'
}
Start-Sleep -Seconds 2

# Que se recupere solo si el proceso se cae.
& sc.exe config cloudflared start= auto | Out-Null
& sc.exe failure cloudflared reset= 60 actions= restart/5000/restart/5000/restart/10000 | Out-Null
Start-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
Write-Ok 'cloudflared corriendo como servicio (arranca solo al prender la PC)'

# ---------------------------------------------------- servicio del file server

Write-Paso 'Servicio del file server'

# El proceso corre como SYSTEM y hereda las variables de la maquina.
[Environment]::SetEnvironmentVariable('IMEDIC_FS_PORT',  "$Port", 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_FS_ROOT',  $Root,   'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_FS_TOKEN', $Token,  'Machine')

$action = New-ScheduledTaskAction -Execute $Node -Argument "`"$FileServerJs`"" -WorkingDirectory $RepoRoot

# AtStartup lo levanta al prender; la repeticion lo revive si murio.
$trigStart = New-ScheduledTaskTrigger -AtStartup
$trigLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
	-RepetitionInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
	-StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action `
	-Trigger @($trigStart, $trigLoop) -Principal $principal -Settings $settings `
	-Description "File server de adjuntos de $Clinica en $Root" | Out-Null

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
Write-Ok 'file server corriendo como tarea de sistema'

# --------------------------------------------------------------------- estado

Write-Paso 'Variables de la clinica'
$envLines = @(
	"# Generado por Instalar-Clinica.ps1 - clinica: $Clinica",
	"IMEDIC_CLINICA=$Clinica",
	"IMEDIC_FS_HOSTNAME=$Hostname",
	"IMEDIC_FS_PORT=$Port",
	"IMEDIC_FS_ROOT=$Root",
	"IMEDIC_FS_TOKEN=$Token"
)
Set-Content -Path $EnvFile -Value ($envLines -join "`r`n") -Encoding UTF8
Write-Ok "variables en $EnvFile"

# ------------------------------------------------------------------ chequeos

Write-Paso 'Verificacion'
$localOk = $false
foreach ($i in 1..15) {
	Start-Sleep -Seconds 2
	try {
		$r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
		if ($r.status -eq 'ok') { $localOk = $true; break }
	} catch { }
}
if ($localOk) { Write-Ok "file server responde en http://127.0.0.1:$Port/health" }
else { Write-Warn "el file server no responde local todavia. Revisa con .\Estado.ps1" }

$publicOk = $false
$headers = @{}
if ($Token) { $headers['x-imedic-token'] = $Token }
foreach ($i in 1..20) {
	Start-Sleep -Seconds 3
	try {
		$r = Invoke-RestMethod -Uri "https://$Hostname/health" -Headers $headers -TimeoutSec 10
		if ($r.status -eq 'ok') { $publicOk = $true; break }
	} catch { }
}

Write-Host ''
if ($publicOk) {
	Write-Host '  LISTO' -ForegroundColor Green
	Write-Host "  https://$Hostname responde y no cambia mas." -ForegroundColor Green
} else {
	Write-Host '  Instalado, pero el hostname publico todavia no responde.' -ForegroundColor Yellow
	Write-Host '  Puede tardar unos minutos. Diagnostico:  .\Estado.ps1' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  Ultimo paso (una sola vez, desde la web):' -ForegroundColor White
Write-Host "  Super Admin > Empresas > $Clinica > FileServerUrl =" -ForegroundColor White
Write-Host "      https://$Hostname" -ForegroundColor Cyan
if ($Token) {
	Write-Host ''
	Write-Host '  Y en Railway (backend), la variable:' -ForegroundColor White
	Write-Host "      FILE_SERVER_TOKEN=$Token" -ForegroundColor Cyan
}
Write-Host ''
