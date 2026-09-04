<#
.SYNOPSIS
	Deja la PC de una clinica publicando sus adjuntos en un hostname fijo.

.DESCRIPTION
	Se corre UNA vez por clinica, como Administrador. Instala:

	  1. cloudflared como servicio de Windows, con un tunel con nombre
	     (permanente). El hostname es fijo: files-<clinica>.imedic.com.ar
	  2. El file server de adjuntos como tarea programada al arranque,
	     escuchando solo en 127.0.0.1.

	No hay Quick Tunnels, no hay URLs de trycloudflare.com, no hay nada que
	actualizar en la base despues de la instalacion. Si la PC se reinicia,
	los dos servicios vuelven solos y el hostname es el mismo.

	Es idempotente: se puede volver a correr para reparar la instalacion.

.PARAMETER Clinica
	Slug de la clinica en minusculas, sin espacios (vidal, sarmiento).
	Define el hostname (files-<clinica>.imedic.com.ar) y el nombre del
	tunel (imedic-<clinica>).

.PARAMETER Root
	Carpeta donde se guardan los adjuntos en el disco de la clinica.

.PARAMETER Port
	Puerto local del file server. Solo escucha en loopback.

.PARAMETER Token
	Opcional. Secreto compartido que el file server va a exigir en el header
	x-imedic-token. Tiene que coincidir con FILE_SERVER_TOKEN del backend.
	Si se omite, la unica proteccion es que el puerto no sale del loopback.

.PARAMETER Recrear
	Borra y vuelve a crear el tunel. Solo si se perdieron las credenciales.

.EXAMPLE
	.\Instalar-Clinica.ps1 -Clinica vidal -Root "E:\adjuntos"

.EXAMPLE
	.\Instalar-Clinica.ps1 -Clinica sarmiento -Root "D:\adjuntos" -Token "unSecretoLargo"
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
	[string]$Clinica,

	[string]$Root = 'E:\adjuntos',

	[int]$Port = 9012,

	[string]$Token = '',

	[string]$Dominio = 'imedic.com.ar',

	[switch]$Recrear
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Hostname     = "files-$Clinica.$Dominio"
$TunnelName   = "imedic-$Clinica"
$RepoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$FileServerJs = Join-Path $RepoRoot 'file-server.js'
$EnvFile      = Join-Path $PSScriptRoot 'clinica.env'
$CfDir        = 'C:\ProgramData\Cloudflare\cloudflared'
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
Write-Host "  tunel:     $TunnelName"
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

New-Item -ItemType Directory -Force -Path $Root  | Out-Null
New-Item -ItemType Directory -Force -Path $CfDir | Out-Null

# ---------------------------------------------------------------------- login

Write-Paso 'Autenticacion de Cloudflare'
$CertUser = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
$CertProg = Join-Path $CfDir 'cert.pem'

if ((Test-Path $CertProg) -and -not (Test-Path $CertUser)) {
	New-Item -ItemType Directory -Force -Path (Split-Path $CertUser) | Out-Null
	Copy-Item $CertProg $CertUser -Force
}

if (Test-Path $CertUser) {
	Write-Ok 'esta PC ya esta autenticada contra Cloudflare'
} else {
	Write-Warn "Se va a abrir el navegador. Elegi el dominio $Dominio y autorizalo."
	& $Cloudflared tunnel login
	if (-not (Test-Path $CertUser)) {
		throw 'No se completo el login de Cloudflare. Volve a correr el script.'
	}
	Write-Ok 'autenticado'
}
Copy-Item $CertUser $CertProg -Force

# ---------------------------------------------------------------------- tunel

Write-Paso 'Tunel permanente'
$lista = (& $Cloudflared tunnel list --output json 2>$null) | Out-String
$tuneles = @()
if ($lista.Trim()) { try { $tuneles = $lista | ConvertFrom-Json } catch { $tuneles = @() } }
$existente = $tuneles | Where-Object { $_.name -eq $TunnelName -and -not $_.deleted_at } | Select-Object -First 1

if ($existente -and $Recrear) {
	Write-Warn "Borrando el tunel $TunnelName para recrearlo..."
	& $Cloudflared tunnel cleanup $TunnelName 2>$null | Out-Null
	& $Cloudflared tunnel delete -f $TunnelName | Out-Host
	$existente = $null
}

if ($existente) {
	$TunnelId = $existente.id
	Write-Ok "el tunel $TunnelName ya existe ($TunnelId)"
} else {
	& $Cloudflared tunnel create $TunnelName | Out-Host
	$lista = (& $Cloudflared tunnel list --output json 2>$null) | Out-String
	$tuneles = $lista | ConvertFrom-Json
	$creado = $tuneles | Where-Object { $_.name -eq $TunnelName -and -not $_.deleted_at } | Select-Object -First 1
	if (-not $creado) { throw "No se pudo crear el tunel $TunnelName." }
	$TunnelId = $creado.id
	Write-Ok "tunel creado ($TunnelId)"
}

# Las credenciales del tunel quedan en el perfil del usuario; el servicio corre
# como LocalSystem, asi que las dejamos en ProgramData y las referenciamos por
# ruta absoluta desde config.yml.
$CredsUser = Join-Path $env:USERPROFILE ".cloudflared\$TunnelId.json"
$CredsProg = Join-Path $CfDir "$TunnelId.json"

if (Test-Path $CredsUser) {
	Copy-Item $CredsUser $CredsProg -Force
} elseif (-not (Test-Path $CredsProg)) {
	throw @"
El tunel $TunnelName existe en Cloudflare pero en esta PC no estan sus credenciales
($TunnelId.json). Eso pasa si se creo desde otra maquina.
Volve a correr con -Recrear para borrarlo y crearlo de nuevo:
    .\Instalar-Clinica.ps1 -Clinica $Clinica -Root "$Root" -Recrear
"@
}
Write-Ok "credenciales en $CredsProg"

# --------------------------------------------------------------------- config

Write-Paso 'Configuracion del tunel'
$configYml = @"
# Generado por Instalar-Clinica.ps1 - clinica: $Clinica
# No editar a mano: volve a correr el script.
tunnel: $TunnelId
credentials-file: $CredsProg
metrics: 127.0.0.1:20241
loglevel: info

ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:$Port
    originRequest:
      connectTimeout: 30s
      # Los estudios pesados tardan; sin esto Cloudflare corta la subida.
      httpHostHeader: 127.0.0.1:$Port
  - service: http_status:404
"@

$ConfigPath = Join-Path $CfDir 'config.yml'
Set-Content -Path $ConfigPath -Value $configYml -Encoding UTF8
Write-Ok "config.yml en $ConfigPath"

# Distintas versiones de cloudflared buscan el config en distintos lugares.
foreach ($dir in @(
	(Join-Path $env:USERPROFILE '.cloudflared'),
	'C:\Windows\System32\config\systemprofile\.cloudflared'
)) {
	try {
		New-Item -ItemType Directory -Force -Path $dir | Out-Null
		Copy-Item $ConfigPath (Join-Path $dir 'config.yml') -Force
		Copy-Item $CredsProg (Join-Path $dir "$TunnelId.json") -Force
		Copy-Item $CertProg  (Join-Path $dir 'cert.pem') -Force
	} catch {
		Write-Warn "no pude copiar la config a $dir ($($_.Exception.Message))"
	}
}

# ------------------------------------------------------------------------ dns

Write-Paso 'DNS'
& $Cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
	throw "No se pudo apuntar $Hostname al tunel. Verifica que $Dominio este activo en Cloudflare."
}
Write-Ok "$Hostname -> $TunnelName"

# -------------------------------------------------------------------- archivo

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

# --------------------------------------------------------- servicio del tunel

Write-Paso 'Servicio de cloudflared'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
	Write-Warn 'ya existia el servicio, reinstalandolo con la config nueva...'
	& $Cloudflared service uninstall 2>&1 | Out-Null
	Start-Sleep -Seconds 2
}
& $Cloudflared --config $ConfigPath service install 2>&1 | Out-Host
Start-Sleep -Seconds 2

# Que se recupere solo si el proceso se cae.
& sc.exe config cloudflared start= auto | Out-Null
& sc.exe failure cloudflared reset= 60 actions= restart/5000/restart/5000/restart/10000 | Out-Null
Start-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
Write-Ok 'cloudflared corriendo como servicio (arranca solo al prender la PC)'

# ---------------------------------------------------- servicio del file server

Write-Paso 'Servicio del file server'
$fsArgs = "`"$FileServerJs`""
$action = New-ScheduledTaskAction -Execute $Node -Argument $fsArgs -WorkingDirectory $RepoRoot

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

# El proceso hereda las variables de la maquina, no el clinica.env.
[Environment]::SetEnvironmentVariable('IMEDIC_FS_PORT',  "$Port", 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_FS_ROOT',  $Root,   'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_FS_TOKEN', $Token,  'Machine')

Stop-Process -Name node -ErrorAction SilentlyContinue -Force
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName $TaskName
Write-Ok 'file server corriendo como tarea de sistema'

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
else { Write-Warn "el file server no responde local todavia. Log: Get-ScheduledTaskInfo '$TaskName'" }

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
	Write-Host "  El DNS de Cloudflare puede tardar unos minutos. Probá:" -ForegroundColor Yellow
	Write-Host "      curl https://$Hostname/health" -ForegroundColor Yellow
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
