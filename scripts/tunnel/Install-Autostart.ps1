#Requires -RunAsAdministrator
<#
  Instala tarea programada: al iniciar sesion arranca file server + tunel OCULTOS.

  PowerShell (Admin):
    cd ...\iMedicSaaSBack\scripts\tunnel
    powershell -ExecutionPolicy Bypass -File .\Install-Autostart.ps1
#>
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $dir 'start-adjuntos-hidden.vbs'
if (-not (Test-Path -LiteralPath $vbs)) { throw "No existe $vbs" }

$taskName = 'iMedic Adjuntos Tunnel'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Tarea '$taskName' instalada. Arranca oculta al iniciar sesion."
Write-Host "Probar ahora:  schtasks /Run /TN `"$taskName`""
Write-Host "Quitar:        Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
