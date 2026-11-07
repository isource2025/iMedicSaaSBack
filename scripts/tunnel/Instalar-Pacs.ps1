<#
.SYNOPSIS
	Instala el bridge PACS + túnel Cloudflare (pacs-<clinica>.imedic.com.ar).

.DESCRIPTION
	Se corre en la PC del tomógrafo (ClearCanvas), como Administrador.

	Por defecto usa el MISMO camino que los adjuntos sin API token:
	  cloudflared tunnel login → crea túnel → DNS → servicio Windows
	  + pacs-bridge.js en 127.0.0.1:9013

	NO hace falta CF_API_TOKEN ni nada en Railway. Solo un login de
	Cloudflare en el navegador la primera vez (elige imedic.com.ar).

.PARAMETER TunnelToken
	Opcional. Solo si ya tenés un token de un túnel administrado por API.
	Si no lo pasás, se usa login CLI (recomendado).

.EXAMPLE
	.\Instalar-Pacs.ps1 -Clinica sarmiento -SqlUser imedic_pacs_ro
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
	[string]$Clinica,

	[string]$TunnelToken = '',

	[string]$SqlUser = 'imedic_pacs_ro',

	[string]$SqlPassword = '',

	[string]$SqlServer = 'localhost\SQLCC',

	[string]$SqlDatabase = 'ImageServer',

	[string]$FsRoot = 'D:\FS',

	[int]$Port = 9013,

	[string]$Token = '',

	[string]$Dominio = 'imedic.com.ar',

	[switch]$Recrear
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Hostname   = "pacs-$Clinica.$Dominio"
$TunnelName = "imedic-pacs-$Clinica"
$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BridgeJs   = Join-Path $RepoRoot 'pacs-bridge.js'
$EnvFile    = Join-Path $PSScriptRoot 'pacs.env'
$CfDir      = 'C:\ProgramData\Cloudflare\cloudflared'
$TaskName   = 'iMedic PACS Bridge'
$ModoApi    = [bool]$TunnelToken

function Write-Paso { param([string]$m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    !   $m" -ForegroundColor Yellow }

function Assert-Admin {
	$id = [Security.Principal.WindowsIdentity]::GetCurrent()
	$pr = New-Object Security.Principal.WindowsPrincipal($id)
	if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
		throw 'Correr como Administrador.'
	}
}

function Get-CloudflaredPath {
	$cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	foreach ($p in @(
		"$env:ProgramFiles\cloudflared\cloudflared.exe",
		"${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
	)) {
		if (Test-Path $p) { return $p }
	}
	return $null
}

function Install-Cloudflared {
	$exe = Get-CloudflaredPath
	if ($exe) { Write-Ok "cloudflared: $exe"; return $exe }
	Write-Warn 'Bajando cloudflared...'
	$dir = "$env:ProgramFiles\cloudflared"
	New-Item -ItemType Directory -Force -Path $dir | Out-Null
	$exe = Join-Path $dir 'cloudflared.exe'
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe -UseBasicParsing
	$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
	if ($machinePath -notlike "*$dir*") {
		[Environment]::SetEnvironmentVariable('Path', "$machinePath;$dir", 'Machine')
	}
	$env:Path = "$env:Path;$dir"
	Write-Ok "cloudflared instalado: $exe"
	return $exe
}

function Get-NodePath {
	$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
		if (Test-Path $p) { return $p }
	}
	throw 'Falta Node.js LTS. Instalalo desde https://nodejs.org y volvé a correr.'
}

Assert-Admin

if (-not $SqlPassword) {
	$sec = Read-Host -AsSecureString "Password SQL para $SqlUser"
	$SqlPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
		[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
	)
}

Write-Host ''
Write-Host '  Instalacion PACS iMedic' -ForegroundColor White
Write-Host "  clinica:   $Clinica"
Write-Host "  hostname:  https://$Hostname"
Write-Host "  bridge:    127.0.0.1:$Port"
Write-Host "  SQL:       $SqlServer / $SqlDatabase"
Write-Host "  FS:        $FsRoot"
Write-Host "  modo:      $(if ($ModoApi) { 'token API' } else { 'CLI cloudflared login (sin CF_API_TOKEN)' })"

if (-not (Test-Path $BridgeJs)) { throw "No encuentro pacs-bridge.js en $RepoRoot" }
if (-not (Test-Path $FsRoot)) { Write-Warn "No existe $FsRoot — el bridge arranca igual, pero /files fallará." }

Write-Paso 'Dependencias'
$Cloudflared = Install-Cloudflared
$Node = Get-NodePath
Write-Ok "node: $Node"

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules\express')) -or -not (Test-Path (Join-Path $RepoRoot 'node_modules\mssql'))) {
	Write-Warn 'npm install --omit=dev...'
	Push-Location $RepoRoot
	try { & npm install --omit=dev | Out-Host }
	finally { Pop-Location }
}

New-Item -ItemType Directory -Force -Path $CfDir | Out-Null

Write-Paso 'pacs.env'
@"
IMEDIC_PACS_PORT=$Port
IMEDIC_PACS_SQL_SERVER=$SqlServer
IMEDIC_PACS_SQL_DATABASE=$SqlDatabase
IMEDIC_PACS_SQL_USER=$SqlUser
IMEDIC_PACS_SQL_PASSWORD=$SqlPassword
IMEDIC_PACS_FS_ROOT=$FsRoot
IMEDIC_PACS_TOKEN=$Token
IMEDIC_PACS_HOSTNAME=https://$Hostname
"@ | Set-Content -Path $EnvFile -Encoding ASCII
# También a variables de máquina (la tarea SYSTEM las ve)
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_PORT', "$Port", 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_SQL_SERVER', $SqlServer, 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_SQL_DATABASE', $SqlDatabase, 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_SQL_USER', $SqlUser, 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_SQL_PASSWORD', $SqlPassword, 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_FS_ROOT', $FsRoot, 'Machine')
[Environment]::SetEnvironmentVariable('IMEDIC_PACS_TOKEN', $Token, 'Machine')
Write-Ok $EnvFile

$ConfigPath = $null

if (-not $ModoApi) {
	Write-Paso 'Autenticacion Cloudflare (igual que adjuntos)'
	$CertUser = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
	$CertProg = Join-Path $CfDir 'cert.pem'

	if ((Test-Path $CertProg) -and -not (Test-Path $CertUser)) {
		New-Item -ItemType Directory -Force -Path (Split-Path $CertUser) | Out-Null
		Copy-Item $CertProg $CertUser -Force
	}

	if (Test-Path $CertUser) {
		Write-Ok 'esta PC ya esta autenticada contra Cloudflare'
	} else {
		Write-Warn "Se abre el navegador. Elegi el dominio $Dominio y autorizalo."
		& $Cloudflared tunnel login
		if (-not (Test-Path $CertUser)) {
			throw "No se completo el login. Agrega $Dominio en Cloudflare si no aparece."
		}
		Write-Ok 'autenticado'
	}
	Copy-Item $CertUser $CertProg -Force

	Write-Paso "Tunel $TunnelName"
	$lista = (& $Cloudflared tunnel list --output json 2>$null) | Out-String
	$tuneles = @()
	if ($lista.Trim()) { try { $tuneles = $lista | ConvertFrom-Json } catch { $tuneles = @() } }
	$existente = $tuneles | Where-Object { $_.name -eq $TunnelName -and -not $_.deleted_at } | Select-Object -First 1

	if ($existente -and $Recrear) {
		Write-Warn "Borrando $TunnelName..."
		& $Cloudflared tunnel cleanup $TunnelName 2>$null | Out-Null
		& $Cloudflared tunnel delete -f $TunnelName | Out-Host
		$existente = $null
	}

	if ($existente) {
		$TunnelId = $existente.id
		Write-Ok "ya existe ($TunnelId)"
	} else {
		& $Cloudflared tunnel create $TunnelName | Out-Host
		$lista = (& $Cloudflared tunnel list --output json 2>$null) | Out-String
		$tuneles = $lista | ConvertFrom-Json
		$creado = $tuneles | Where-Object { $_.name -eq $TunnelName -and -not $_.deleted_at } | Select-Object -First 1
		if (-not $creado) { throw "No se pudo crear $TunnelName" }
		$TunnelId = $creado.id
		Write-Ok "creado ($TunnelId)"
	}

	$CredsUser = Join-Path $env:USERPROFILE ".cloudflared\$TunnelId.json"
	$CredsProg = Join-Path $CfDir "$TunnelId.json"
	if (Test-Path $CredsUser) { Copy-Item $CredsUser $CredsProg -Force }
	elseif (-not (Test-Path $CredsProg)) {
		throw "Faltan credenciales del tunel ($TunnelId.json). Corré con -Recrear."
	}

	$configYml = @"
# Generado por Instalar-Pacs.ps1 - clinica: $Clinica
tunnel: $TunnelId
credentials-file: $CredsProg
metrics: 127.0.0.1:20242
loglevel: info

ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:$Port
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
"@
	$ConfigPath = Join-Path $CfDir 'config-pacs.yml'
	Set-Content -Path $ConfigPath -Value $configYml -Encoding UTF8
	Write-Ok "config en $ConfigPath"

	Write-Paso 'DNS'
	& $Cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname 2>&1 | Out-Host
	if ($LASTEXITCODE -ne 0) {
		throw "No se pudo apuntar $Hostname. Verifica que $Dominio este en Cloudflare."
	}
	Write-Ok "$Hostname -> $TunnelName"

	# Guardar TunnelId en env local (no es el token API; es id del túnel)
	Add-Content -Path $EnvFile -Value "IMEDIC_PACS_TUNNEL_ID=$TunnelId" -Encoding ASCII
	[Environment]::SetEnvironmentVariable('IMEDIC_PACS_TUNNEL_ID', "$TunnelId", 'Machine')
	[Environment]::SetEnvironmentVariable('IMEDIC_PACS_HOSTNAME', "https://$Hostname", 'Machine')
}

Write-Paso 'Servicio cloudflared'
# Ojo: si ya hay un cloudflared de adjuntos en ESTA misma PC, no lo pisamos:
# corremos el túnel PACS como tarea aparte con --config.
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($ModoApi) {
	if ($svc) {
		Write-Warn 'Ya hay servicio cloudflared. Se reinstala con el token PACS (solo si esta PC es solo PACS).'
		& $Cloudflared service uninstall 2>$null | Out-Null
		Start-Sleep -Seconds 2
	}
	& $Cloudflared service install $TunnelToken 2>&1 | Out-Host
	& sc.exe config cloudflared start= auto | Out-Null
	Start-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
	Write-Ok 'servicio cloudflared (token)'
} else {
	$CfTask = 'iMedic cloudflared PACS'
	Unregister-ScheduledTask -TaskName $CfTask -Confirm:$false -ErrorAction SilentlyContinue
	$cfAction = New-ScheduledTaskAction -Execute $Cloudflared -Argument "tunnel --config `"$ConfigPath`" run"
	$cfTrig = New-ScheduledTaskTrigger -AtStartup
	$cfPrin = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
	$cfSet = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
	Register-ScheduledTask -TaskName $CfTask -Action $cfAction -Trigger $cfTrig -Principal $cfPrin -Settings $cfSet -Description "Tunel $TunnelName" | Out-Null
	Start-ScheduledTask -TaskName $CfTask
	Write-Ok "tarea $CfTask (no pisa el cloudflared de adjuntos si existiera)"
}

Write-Paso "Tarea $TaskName"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$launcher = Join-Path $PSScriptRoot 'Start-PacsBridge.cmd'
@"
@echo off
cd /d "$RepoRoot"
for /f "usebackq tokens=1,* delims==" %%A in ("$EnvFile") do (
  if not "%%A"=="" if not "%%A"=="#" set "%%A=%%B"
)
"$Node" "$BridgeJs"
"@ | Set-Content -Path $launcher -Encoding ASCII

$action = New-ScheduledTaskAction -Execute $launcher
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger, $trigLoop) -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Ok 'bridge arrancado'

Write-Paso 'Prueba local'
Start-Sleep -Seconds 4
try {
	$h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 20
	Write-Ok ("health ok={0} sql={1}" -f $h.ok, $h.sql)
} catch {
	Write-Warn "health aún no responde: $($_.Exception.Message)"
}

Write-Host ''
Write-Host "  Hostname: https://$Hostname" -ForegroundColor Green
Write-Host "  En tu PC / repo, grabá PacsUrl:" -ForegroundColor Green
Write-Host "    node scripts/tunnel/set-pacs-url.js --empresa 101 --url https://$Hostname"
Write-Host ''
