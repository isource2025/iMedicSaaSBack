<#
.SYNOPSIS
	Tunel fijo de Vidal (reemplazo del Start-QuickTunnel.ps1).

.DESCRIPTION
	Misma UX que el provisional: doble clic en arrancar-tunel.cmd.
	Hostname fijo: https://files-vidal.imedic.com.ar
	No genera URLs de trycloudflare.com.
#>
[CmdletBinding()]
param(
	[string]$Root = 'E:\adjuntos',
	[int]$EmpresaId = 1
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PcDir = $PSScriptRoot
$TunnelDir = Split-Path $PcDir -Parent
$RepoRoot = (Resolve-Path (Join-Path $TunnelDir '..\..')).Path
$Instalar = Join-Path $TunnelDir 'Instalar-Clinica.ps1'

$tokenFile = Join-Path $PcDir 'tunnel-token.txt'
if (-not (Test-Path $tokenFile)) {
	$tokenFile = Join-Path $TunnelDir '.vidal-tunnel-token.txt'
}
if (-not (Test-Path $tokenFile)) {
	throw @"
No encuentro tunnel-token.txt en:
  $PcDir
  ni .vidal-tunnel-token.txt en $TunnelDir
"@
}

$token = (Get-Content $tokenFile -Raw -Encoding UTF8).Trim()
if (-not $token) { throw "El archivo $tokenFile esta vacio." }

if (-not (Test-Path $Instalar)) {
	throw "No encuentro Instalar-Clinica.ps1 en $TunnelDir. Corre esto desde el repo iMedicSaaSBack."
}

Write-Host ''
Write-Host '  iMedic Vidal - tunel FIJO' -ForegroundColor Cyan
Write-Host '  https://files-vidal.imedic.com.ar' -ForegroundColor White
Write-Host "  carpeta: $Root"
Write-Host "  repo:    $RepoRoot"
Write-Host ''

& $Instalar `
	-Clinica vidal `
	-Root $Root `
	-EmpresaId $EmpresaId `
	-TunnelToken $token
