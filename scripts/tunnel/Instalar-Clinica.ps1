<#
.SYNOPSIS
	Deja la PC de una clinica publicando sus adjuntos en un hostname fijo.

.DESCRIPTION
	Se corre UNA vez por clinica, como Administrador. Instala dos cosas como
	servicios de Windows:

	  1. cloudflared, conectado a un tunel con nombre permanente que publica
	     files-<clinica>.imedic.com.ar
	  2. El file server de adjuntos, escuchando solo en 127.0.0.1.

	No hay Quick Tunnels ni URLs de trycloudflare.com. Si la PC se reinicia,
	los dos servicios vuelven solos y el hostname es el mismo de siempre.
	Es idempotente: se puede volver a correr para reparar la instalacion.

	Tiene dos modos segun como se autentique contra Cloudflare:

	  Sin -TunnelToken (todo por CLI, no hace falta ningun API token)
	      Usa "cloudflared tunnel login": abre el navegador una vez para
	      autorizar el dominio y deja un cert.pem. Con eso el script crea el
	      tunel, apunta el DNS y escribe la config, todo por comando.

	  Con -TunnelToken (tunel administrado por Cloudflare)
	      El tunel, su ingress y su DNS ya fueron creados por API con
	      scripts/cloudflare/cf-setup.js, que imprime ese token. Aca no hay
	      login ni config local.

.PARAMETER Clinica
	Slug de la clinica en minusculas (vidal, sarmiento). Define el hostname
	y el nombre del tunel.

.PARAMETER Root
	Carpeta donde se guardan los adjuntos en el disco de la clinica.

.PARAMETER Port
	Puerto local del file server. Solo escucha en loopback.

.PARAMETER Token
	Opcional. Secreto compartido que el file server exige en el header
	x-imedic-token. Tiene que coincidir con FILE_SERVER_TOKEN del backend.

.PARAMETER EmpresaId
	Opcional. IDEMPRESA en Super Admin para grabar FileServerUrl automaticamente.
	Si no se pasa, se intenta resolver por el slug de -Clinica.

.PARAMETER TunnelToken
	Opcional. Token que imprime cf-setup.js. Es una credencial: no lo
	commitees ni lo pegues en un chat.

.PARAMETER Recrear
	Borra y vuelve a crear el tunel. Solo en modo CLI, y solo si se perdieron
	las credenciales locales.

.EXAMPLE
	.\Instalar-Clinica.ps1 -Clinica vidal -Root "E:\adjuntos"

.EXAMPLE
	.\Instalar-Clinica.ps1 -Clinica vidal -Root "E:\adjuntos" -TunnelToken "eyJhIjoi..."
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
	[string]$Clinica,

	[string]$Root = 'E:\adjuntos',

	[int]$Port = 9012,

	[string]$Token = '',

	[int]$EmpresaId = 0,

	[string]$TunnelToken = '',

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
$ModoApi      = [bool]$TunnelToken

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
Write-Host "  modo:      $(if ($ModoApi) { 'tunel administrado por Cloudflare' } else { 'CLI con cloudflared login' })"

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
Write-Ok "carpeta de adjuntos: $Root"

# --------------------------------------------------- modo CLI: login y tunel

$ConfigPath = $null

if (-not $ModoApi) {
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
			throw "No se completo el login. Si $Dominio no aparece en la lista, primero hay que agregarlo en Cloudflare."
		}
		Write-Ok 'autenticado'
	}
	Copy-Item $CertUser $CertProg -Force

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

	# Las credenciales quedan en el perfil del usuario, pero el servicio corre
	# como LocalSystem y no ve %USERPROFILE%: van a ProgramData y se
	# referencian por ruta absoluta desde config.yml.
	$CredsUser = Join-Path $env:USERPROFILE ".cloudflared\$TunnelId.json"
	$CredsProg = Join-Path $CfDir "$TunnelId.json"

	if (Test-Path $CredsUser) {
		Copy-Item $CredsUser $CredsProg -Force
	} elseif (-not (Test-Path $CredsProg)) {
		throw @"
El tunel $TunnelName existe en Cloudflare pero en esta PC no estan sus
credenciales ($TunnelId.json). Eso pasa si se creo desde otra maquina.
Volve a correr con -Recrear para borrarlo y crearlo de nuevo.
"@
	}
	Write-Ok "credenciales en $CredsProg"

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

	Write-Paso 'DNS'
	& $Cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname 2>&1 | Out-Host
	if ($LASTEXITCODE -ne 0) {
		throw "No se pudo apuntar $Hostname al tunel. Verifica que $Dominio este activo en Cloudflare."
	}
	Write-Ok "$Hostname -> $TunnelName"
}

# --------------------------------------------------------- servicio del tunel

Write-Paso 'Servicio de cloudflared'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
	Write-Warn 'ya existia el servicio, reinstalandolo...'
	& $Cloudflared service uninstall 2>&1 | Out-Null
	Start-Sleep -Seconds 2
}

if ($ModoApi) {
	# Con el token, cloudflared baja la config del ingress desde Cloudflare.
	& $Cloudflared service install $TunnelToken 2>&1 | Out-Host
	if ($LASTEXITCODE -ne 0) {
		throw 'No se pudo instalar el servicio. Revisa que el -TunnelToken sea el que imprimio cf-setup.js.'
	}
} else {
	& $Cloudflared --config $ConfigPath service install 2>&1 | Out-Host
	if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el servicio de cloudflared.' }
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
Write-Paso 'FileServerUrl en Super Admin'
$setFs = Join-Path $PSScriptRoot 'set-fileserver-url.js'
if (Test-Path $setFs) {
	$fsArgs = @($setFs, '--clinica', $Clinica, '--url', "https://$Hostname")
	if ($EmpresaId -gt 0) { $fsArgs = @($setFs, '--empresa', "$EmpresaId", '--url', "https://$Hostname") }
	& $Node @fsArgs
	if ($LASTEXITCODE -eq 0) {
		Write-Ok "FileServerUrl = https://$Hostname"
	} else {
		Write-Warn 'No se pudo grabar FileServerUrl automaticamente. Correr a mano:'
		Write-Host "      node scripts/tunnel/set-fileserver-url.js --clinica $Clinica --url https://$Hostname" -ForegroundColor Yellow
	}
} else {
	Write-Warn "falta set-fileserver-url.js"
}

Write-Host ''
Write-Host '  Ultimo paso si el automatico fallo:' -ForegroundColor White
Write-Host "  Super Admin > Empresas > $Clinica > FileServerUrl =" -ForegroundColor White
Write-Host "      https://$Hostname" -ForegroundColor Cyan
if ($Token) {
	Write-Host ''
	Write-Host '  Y en Railway (backend), la variable:' -ForegroundColor White
	Write-Host "      FILE_SERVER_TOKEN=$Token" -ForegroundColor Cyan
}
Write-Host ''
