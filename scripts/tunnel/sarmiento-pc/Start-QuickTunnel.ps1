# Este archivo ya no se usa. El unico script es:
#   scripts\tunnel\Start-QuickTunnel.ps1
# Copiarlo a C:\imedic\Start-QuickTunnel.ps1 en la PC de la clinica.

Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Start-QuickTunnel.ps1') -Destination 'C:\imedic\Start-QuickTunnel.ps1' -Force
Write-Host 'Copiado a C:\imedic\Start-QuickTunnel.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\imedic\Start-QuickTunnel.ps1' @args
