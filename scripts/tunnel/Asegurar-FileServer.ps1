#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
	Deja el servidor de archivos de una clinica arrancando solo con Windows.

.DESCRIPTION
	No toca cloudflared ni cambia la URL del tunel.
	Se puede volver a correr: reafirma la tarea y la enciende.

	Lo unico que cambia por clinica es el bloque CONFIG, o estos parametros:

	  -Clinica vidal -LocalRoot E:\adjuntos -UncRoot \\server\Imagenes\Vidal

	Sin -UncRoot el archivo se lee de -LocalRoot y la tarea corre como SYSTEM
	(sigue aunque nadie tenga sesion abierta).
	Con -UncRoot corre como el usuario que instala, porque SYSTEM no ve el disco de red.

.EXAMPLE
	.\Asegurar-FileServer.ps1 -Clinica vidal -LocalRoot E:\adjuntos -UncRoot \\server\Imagenes\Vidal

.EXAMPLE
	.\Asegurar-FileServer.ps1 -Clinica sarmiento -LocalRoot D:\adjuntos
#>
[CmdletBinding()]
param(
	[string]$Clinica,

	[string]$LocalRoot,

	[string]$UncRoot,

	[int]$Port = 0,

	[string]$Dominio = 'imedic.com.ar'
)

$ErrorActionPreference = 'Stop'

# --- CONFIG: unico cambio si no se pasan parametros ---
# UncRoot vacio = el file-server.ps1 de esa PC usa la ruta que ya tiene.
if (-not $Clinica)   { $Clinica   = 'vidal' }
if (-not $LocalRoot) { $LocalRoot = 'E:\adjuntos' }
if (-not $PSBoundParameters.ContainsKey('UncRoot')) { $UncRoot = '' }
if ($Port -le 0)     { $Port      = 9012 }
# --- fin CONFIG ---

$TaskName = 'iMedic File Server'
$InstallDir = 'C:\ProgramData\iMedic'
$EnvFile = Join-Path $InstallDir 'clinica.env'
$Ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$User = "$env:USERDOMAIN\$env:USERNAME"
$Hostname = "files-$Clinica.$Dominio"

function Write-Paso { param([string]$m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Mal  { param([string]$m) Write-Host "    MAL $m" -ForegroundColor Red }

function Read-EnvFile([string]$path) {
	$map = @{}
	if (-not (Test-Path -LiteralPath $path)) { return $map }
	foreach ($linea in Get-Content -LiteralPath $path) {
		if ($linea -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
	}
	return $map
}

# Una corrida anterior deja clinica.env. Los parametros de esta ejecucion pisan eso.
$prev = Read-EnvFile $EnvFile
if (-not $PSBoundParameters.ContainsKey('Clinica') -and $prev['IMEDIC_CLINICA']) { $Clinica = $prev['IMEDIC_CLINICA'] }
if (-not $PSBoundParameters.ContainsKey('LocalRoot') -and $prev['IMEDIC_FS_ROOT']) { $LocalRoot = $prev['IMEDIC_FS_ROOT'] }
if (-not $PSBoundParameters.ContainsKey('UncRoot') -and $prev.ContainsKey('IMEDIC_FS_UNC')) { $UncRoot = $prev['IMEDIC_FS_UNC'] }
if (-not $PSBoundParameters.ContainsKey('Port') -and $prev['IMEDIC_FS_PORT']) { $Port = [int]$prev['IMEDIC_FS_PORT'] }

if ($Clinica -notmatch '^[a-z0-9][a-z0-9-]*$') { throw "Clinica invalida: '$Clinica'. Use minusculas, por ejemplo vidal." }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$FsScript = Join-Path $InstallDir 'file-server.ps1'
$NodeExe = $null
$Js = $null
if (-not (Test-Path -LiteralPath $FsScript)) {
	$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
	$repoJs = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'file-server.js'
	if ($cmd -and (Test-Path -LiteralPath $repoJs)) {
		$NodeExe = $cmd.Source
		$Js = $repoJs
	}
}
if (-not (Test-Path -LiteralPath $FsScript) -and -not $Js) {
	throw "No esta $FsScript ni file-server.js. Instala el file server de la clinica antes de esta tarea."
}

$raw = ''
if (Test-Path -LiteralPath $FsScript) { $raw = Get-Content -LiteralPath $FsScript -Raw }
$usaRed = [bool]$UncRoot -or ($raw -match '\\\\[A-Za-z0-9_.-]+\\')

Write-Paso "Clinica $Clinica"
Write-Host "    hostname   https://$Hostname"
Write-Host "    local      $LocalRoot"
Write-Host "    red        $(if ($UncRoot) { $UncRoot } else { '(ninguna)' })"
Write-Host "    puerto     127.0.0.1:$Port"
Write-Host "    programa   $(if ($Js) { $Js } else { $FsScript })"
Write-Host "    sesion     $(if ($usaRed) { $User } else { 'SYSTEM' })"

Write-Paso 'Cloudflared (no se modifica)'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) { Write-Ok "servicio $($svc.Status), arranque $($svc.StartType)" }
else { Write-Mal 'no esta el servicio cloudflared. Este script no lo instala.' }

Write-Paso 'Reserva del puerto local'
$url = "http://127.0.0.1:$Port/"
$show = netsh http show urlacl url=$url 2>&1 | Out-String
if ($show -match 'URL reservada|Reserved URL') { Write-Ok "ya reservada $url" }
else {
	netsh http add urlacl url=$url user=Everyone | Out-Null
	Write-Ok "reservada $url"
}

if ($Js) {
	[Environment]::SetEnvironmentVariable('IMEDIC_FS_PORT', "$Port", 'Machine')
	[Environment]::SetEnvironmentVariable('IMEDIC_FS_ROOT', $LocalRoot, 'Machine')
	$action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$Js`"" -WorkingDirectory (Split-Path $Js -Parent)
} else {
	$pass = @()
	if ($UncRoot -and $raw -match '\$UncRoot')   { $pass += "-UncRoot `"$UncRoot`"" }
	if ($LocalRoot -and $raw -match '\$LocalRoot') { $pass += "-LocalRoot `"$LocalRoot`"" }
	elseif ($LocalRoot -and $raw -match '\$Root')  { $pass += "-Root `"$LocalRoot`"" }
	if ($raw -match '\$Port') { $pass += "-Port $Port" }
	$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$FsScript`" $($pass -join ' ')"
	$action = New-ScheduledTaskAction -Execute $Ps -Argument $arg.Trim()
}

$trigLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet `
	-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
	-StartWhenAvailable -MultipleInstances IgnoreNew `
	-RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
	-ExecutionTimeLimit ([TimeSpan]::Zero)

if ($usaRed) {
	$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
	$trigs = @(
		(New-ScheduledTaskTrigger -AtLogOn -User $User),
		(New-ScheduledTaskTrigger -AtStartup),
		$trigLoop
	)
} else {
	$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
	$trigs = @(
		(New-ScheduledTaskTrigger -AtStartup),
		$trigLoop
	)
}

Write-Paso 'Tarea programada'
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigs `
	-Principal $principal -Settings $settings -Force `
	-Description "Adjuntos $Clinica en 127.0.0.1:$Port para https://$Hostname. No borrar." | Out-Null
Write-Ok "tarea '$TaskName' lista"

@(
	"IMEDIC_CLINICA=$Clinica",
	"IMEDIC_FS_HOSTNAME=$Hostname",
	"IMEDIC_FS_PORT=$Port",
	"IMEDIC_FS_ROOT=$LocalRoot",
	"IMEDIC_FS_UNC=$UncRoot"
) | Set-Content -LiteralPath $EnvFile -Encoding UTF8
Write-Ok "config en $EnvFile"

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
	Where-Object {
		$_.Name -match '^(powershell|pwsh)(\.exe)?$' -and $_.CommandLine -like '*file-server-runtime*'
	} |
	ForEach-Object {
		Write-Host "    Cerrando file-server-runtime suelto (PID $($_.ProcessId))"
		Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
	}

Write-Paso 'Encender ahora'
Start-ScheduledTask -TaskName $TaskName
$health = $null
foreach ($i in 1..15) {
	Start-Sleep -Seconds 2
	try {
		$health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
		if ($health.status -eq 'ok' -or $health.success -eq $true) { break }
	} catch { $health = $null }
}

Write-Host ''
if (-not $health) {
	Write-Mal "no respondio http://127.0.0.1:$Port/health"
	Write-Host '  La tarea quedo registrada. Si usa disco de red, este usuario tiene que poder abrirlo.' -ForegroundColor Yellow
	exit 1
}

Write-Ok ("local http://127.0.0.1:{0}/health  {1}" -f $Port, ($health | ConvertTo-Json -Compress))
Write-Host ''
Write-Host "  Tunel sin cambios: https://$Hostname/health" -ForegroundColor White
if ($usaRed) {
	Write-Host "  Corre como $User mientras esa sesion este abierta (el disco de red no se ve como SYSTEM)." -ForegroundColor White
}
exit 0
