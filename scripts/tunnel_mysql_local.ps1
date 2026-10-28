# Abre el túnel SSH a MySQL de Railway en 127.0.0.1:3307
# Dejá esta ventana abierta mientras corrés el backend local.
# Requiere: railway login + clave SSH registrada (railway ssh keys add)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Write-Host "Abriendo túnel MySQL Railway → 127.0.0.1:3307 ..."
Write-Host "Dejá esta ventana abierta. En otra: npm run dev / node src/server.js"
Write-Host ""

railway connect MySQL --tunnel-only -P 3307
