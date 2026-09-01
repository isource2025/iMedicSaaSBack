#Requires -Version 5.1
<#
  PC Clinica Vidal — copia el script unificado y lo ejecuta con sus defaults.

  Primera vez / URL nueva (file server + tunel + FileServerUrl en Super Admin empresa 1):
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\imedic\Start-QuickTunnel.ps1

  Solo reiniciar file server (tunel NO cambia):
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\imedic\Start-QuickTunnel.ps1 -KeepTunnel

  Desde el repo (antes de copiar a C:\imedic):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tunnel\vidal-pc\Start-QuickTunnel.ps1
#>
param(
	[switch] $KeepTunnel,
	[switch] $SkipApi
)

$src = Join-Path $PSScriptRoot '..\Start-QuickTunnel.ps1'
$destDir = 'C:\imedic'
$dest = Join-Path $destDir 'Start-QuickTunnel.ps1'

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item -LiteralPath $src -Destination $dest -Force

$argsList = @(
	'-Root', 'E:\imagenes\vidal',
	'-EmpresaId', '1',
	'-EmpresaMatch', 'vidal'
)
if ($KeepTunnel) { $argsList += '-KeepTunnel' }
if ($SkipApi) { $argsList += '-SkipApi' }

Write-Host 'iMedic Vidal — E:\imagenes\vidal, empresa 1, graba FileServerUrl en Super Admin'
powershell -NoProfile -ExecutionPolicy Bypass -File $dest @argsList
