' Arranca file server + tunel SIN ventana, y graba FileServerUrl en Super Admin.
' Uso: doble clic, o tarea programada al iniciar sesion.
Option Explicit
Dim sh, fso, dir, ps1
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\Start-QuickTunnel.ps1"
' 0 = oculto, False = no esperar. El .ps1 arranca los procesos y sale.
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
