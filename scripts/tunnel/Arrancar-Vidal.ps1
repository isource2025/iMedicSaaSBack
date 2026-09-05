<#
.SYNOPSIS
	Un solo comando para Vidal: tunel fijo + FileServerUrl en Super Admin.

.DESCRIPTION
	Corre en la PC de Vidal, como Administrador, UNA vez.

	1. Instala cloudflared + file server como servicios
	2. Usa el TunnelToken de Cloudflare (API)
	3. Graba https://files-vidal.imedic.com.ar en Empresas.FileServerUrl

.EXAMPLE
	.\Arrancar-Vidal.ps1
#>
[CmdletBinding()]
param(
	[string]$Root = 'E:\adjuntos',
	[int]$EmpresaId = 1
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$tokenFile = Join-Path $here '.vidal-tunnel-token.txt'

if (-not (Test-Path $tokenFile)) {
	throw "Falta $tokenFile. Generarlo desde el repo con el CF_TUNNEL_TOKEN."
}

$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) {
	throw 'El archivo del TunnelToken esta vacio.'
}

Write-Host ''
Write-Host '  Arranque unico Vidal -> files-vidal.imedic.com.ar' -ForegroundColor Cyan
Write-Host ''

& (Join-Path $here 'Instalar-Clinica.ps1') `
	-Clinica vidal `
	-Root $Root `
	-EmpresaId $EmpresaId `
	-TunnelToken $token
