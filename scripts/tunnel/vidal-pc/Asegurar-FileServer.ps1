#Requires -Version 5.1
# Atajo de Vidal. Otro cliente: el mismo script, cambiando solo clinica y carpetas.
& (Join-Path (Split-Path $PSScriptRoot -Parent) 'Asegurar-FileServer.ps1') `
	-Clinica vidal `
	-LocalRoot 'E:\adjuntos' `
	@args
