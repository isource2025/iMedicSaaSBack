#Requires -RunAsAdministrator
<#
  iMedic — instalador UNA VEZ por clinica (sin repo en la PC).

  1) Editar solo el bloque CONFIG abajo (5 campos).
  2) Crear el tunel en Cloudflare (cf-setup.js) y pegar TunnelToken.
  3) PowerShell como Administrador:

       Set-ExecutionPolicy Bypass -Scope Process -Force
       .\Instalar-Clinica-UnaVez.ps1

  Instala:
    - file server PowerShell (UNC + fallback local) como el usuario logueado
    - cloudflared como servicio Windows
    - FileServerUrl en Super Admin (si hay SaPass)
#>

# =============================================================================
# CONFIG — lo unico que cambia por clinica
# =============================================================================
$Clinica     = 'vidal'                       # slug -> files-vidal.imedic.com.ar
$EmpresaId   = 1                             # IDEMPRESA en Super Admin
$UncRoot     = '\\server\Imagenes\Vidal'     # share/carpeta real de adjuntos
$LocalRoot   = 'E:\adjuntos'                 # fallback si el UNC no responde
$TunnelToken = 'PEGAR_TOKEN_DE_CF_SETUP'     # token del tunel (cf-setup.js)
# Opcional:
$Port        = 9012
$Dominio     = 'imedic.com.ar'
$ApiBase     = 'https://imedicsaasback-production.up.railway.app/api'
$SaUser      = 'superadmin'                  # vacio = no graba FileServerUrl por API
$SaPass      = ''                            # password SA (o dejar vacio y poner URL a mano)
# =============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Off

$Clinica = $Clinica.Trim().ToLowerInvariant()
if ($Clinica -notmatch '^[a-z0-9][a-z0-9-]*$') { throw "Clinica invalida: $Clinica" }
if (-not $UncRoot) { throw 'Falta UncRoot en CONFIG' }
if (-not $LocalRoot) { throw 'Falta LocalRoot en CONFIG' }
if (-not $TunnelToken -or $TunnelToken -like 'PEGAR_*') {
	throw 'Falta TunnelToken en CONFIG (generarlo con cf-setup.js)'
}

$Hostname   = "files-$Clinica.$Dominio"
$TaskName   = 'iMedic File Server'
$InstallDir = 'C:\ProgramData\iMedic'
$FsScript   = Join-Path $InstallDir 'file-server.ps1'
$User       = "$env:USERDOMAIN\$env:USERNAME"
$MaxMb      = 100

function Write-Paso { param([string]$m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    !   $m" -ForegroundColor Yellow }

function Get-CloudflaredPath {
	$cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	foreach ($p in @(
		"$env:ProgramFiles\cloudflared\cloudflared.exe",
		"${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
	)) { if (Test-Path $p) { return $p } }
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
	Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
		-OutFile $exe -UseBasicParsing
	$mp = [Environment]::GetEnvironmentVariable('Path', 'Machine')
	if ($mp -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', "$mp;$dir", 'Machine') }
	$env:Path = "$env:Path;$dir"
	Write-Ok "instalado: $exe"
	return $exe
}

# -------------------- file server (UNC + local) --------------------

$FileServerSource = @'
param(
	[string]$UncRoot = '__UNC_ROOT__',
	[string]$LocalRoot = '__LOCAL_ROOT__',
	[int]$Port = 9012,
	[int]$MaxMb = 100
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LocalRoot -ErrorAction SilentlyContinue | Out-Null
$MaxBytes = $MaxMb * 1MB
$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "[iMedic FS] $prefix unc=$UncRoot local=$LocalRoot"

function Send-Json($ctx, $code, $obj) {
	$json = ($obj | ConvertTo-Json -Compress -Depth 6)
	$bytes = [Text.Encoding]::UTF8.GetBytes($json)
	$ctx.Response.StatusCode = $code
	$ctx.Response.ContentType = 'application/json; charset=utf-8'
	$ctx.Response.Headers['Access-Control-Allow-Origin'] = '*'
	$ctx.Response.Headers['Access-Control-Allow-Methods'] = 'GET,POST,DELETE,OPTIONS'
	$ctx.Response.Headers['Access-Control-Allow-Headers'] = '*'
	$ctx.Response.ContentLength64 = $bytes.Length
	$ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
	$ctx.Response.Close()
}

function Decode-Path([string]$p) {
	if (-not $p) { return $p }
	try { $p = [Uri]::UnescapeDataString($p) } catch {}
	$p = $p -replace '/', '\'
	while ($p -match '^\\\\\\+') { $p = $p -replace '^\\\\', '\' }
	$localDrive = [IO.Path]::GetPathRoot($LocalRoot)
	if ($localDrive -and $p -match '^[A-Za-z]:\\' -and -not $p.StartsWith($localDrive, [StringComparison]::OrdinalIgnoreCase)) {
		$p = $localDrive + $p.Substring(3)
	}
	return $p
}

function Map-Path([string]$p) {
	$p = Decode-Path $p
	if (-not $p) { return $null }
	if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
	if ($p -like '\\*') {
		if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
	}
	$uncNorm = $UncRoot.TrimEnd('\')
	if ($p.StartsWith($uncNorm, [StringComparison]::OrdinalIgnoreCase)) {
		$rel = $p.Substring($uncNorm.Length).TrimStart('\')
		$local = Join-Path $LocalRoot $rel
		if (Test-Path -LiteralPath $local -PathType Leaf) { return $local }
	}
	$name = Split-Path $p -Leaf
	$c1 = Join-Path $LocalRoot $name
	if (Test-Path -LiteralPath $c1 -PathType Leaf) { return $c1 }
	return $null
}

function Safe-Name([string]$name) {
	$base = [IO.Path]::GetFileName(($name -replace '[\\/]', '/'))
	if (-not $base) { $base = 'archivo' }
	return (($base -replace '[<>:"|?*\x00-\x1F]', '_').Trim())
}

function Build-Dest($visita, $paciente, $fileName) {
	$safe = Safe-Name $fileName
	$n = if ($paciente) { ($paciente.Trim().ToUpper() -replace '[\\/:*?"<>|]', ' ' -replace '\s+', ' ').Trim() } else { '' }
	$v = if ($visita) { $visita.Trim() } else { '' }
	$base = if (Test-Path -LiteralPath $UncRoot) { $UncRoot } else { $LocalRoot }
	if ($v -and $n) { return (Join-Path (Join-Path $base "$v $n") $safe) }
	if ($v) { return (Join-Path (Join-Path $base $v) $safe) }
	return (Join-Path $base $safe)
}

function Read-Multipart($request) {
	$ms = New-Object IO.MemoryStream
	$request.InputStream.CopyTo($ms)
	$raw = $ms.ToArray()
	$ms.Dispose()
	$contentType = $request.ContentType
	if ($contentType -notmatch 'boundary=(.+)$') { throw 'multipart sin boundary' }
	$boundary = [Text.Encoding]::ASCII.GetBytes('--' + $Matches[1].Trim().Trim('"'))
	$parts = @{}
	$filePart = $null
	$i = 0
	while ($i -lt $raw.Length) {
		$start = IndexOfBytes $raw $boundary $i
		if ($start -lt 0) { break }
		$start += $boundary.Length
		if ($start + 1 -lt $raw.Length -and $raw[$start] -eq 45 -and $raw[$start+1] -eq 45) { break }
		if ($raw[$start] -eq 13) { $start += 2 } elseif ($raw[$start] -eq 10) { $start += 1 }
		$headerEnd = IndexOfBytes $raw ([Text.Encoding]::ASCII.GetBytes("`r`n`r`n")) $start
		if ($headerEnd -lt 0) { break }
		$headerText = [Text.Encoding]::UTF8.GetString($raw, $start, $headerEnd - $start)
		$bodyStart = $headerEnd + 4
		$next = IndexOfBytes $raw $boundary $bodyStart
		if ($next -lt 0) { $next = $raw.Length }
		$bodyEnd = $next - 2
		if ($bodyEnd -lt $bodyStart) { $bodyEnd = $next }
		$len = [Math]::Max(0, $bodyEnd - $bodyStart)
		$body = New-Object byte[] $len
		[Array]::Copy($raw, $bodyStart, $body, 0, $len)
		$name = $null; $filename = $null
		if ($headerText -match 'name="([^"]+)"') { $name = $Matches[1] }
		if ($headerText -match "filename\*=UTF-8''([^;\r\n]+)") {
			$filename = [Uri]::UnescapeDataString($Matches[1].Trim())
		} elseif ($headerText -match 'filename="([^"]*)"') {
			$filename = $Matches[1]
		}
		if ($filename) { $filePart = @{ name = $name; filename = $filename; bytes = $body } }
		elseif ($name) { $parts[$name] = [Text.Encoding]::UTF8.GetString($body).TrimEnd("`0") }
		$i = $next
	}
	return @{ fields = $parts; file = $filePart }
}

function IndexOfBytes([byte[]]$hay, [byte[]]$needle, [int]$from) {
	for ($i = $from; $i -le $hay.Length - $needle.Length; $i++) {
		$ok = $true
		for ($j = 0; $j -lt $needle.Length; $j++) {
			if ($hay[$i+$j] -ne $needle[$j]) { $ok = $false; break }
		}
		if ($ok) { return $i }
	}
	return -1
}

while ($listener.IsListening) {
	$ctx = $null
	try {
		$ctx = $listener.GetContext()
		$req = $ctx.Request
		$method = $req.HttpMethod.ToUpperInvariant()
		$path = $req.Url.AbsolutePath.TrimEnd('/')
		if (-not $path) { $path = '/' }

		if ($method -eq 'OPTIONS') {
			$ctx.Response.StatusCode = 204
			$ctx.Response.Headers['Access-Control-Allow-Origin'] = '*'
			$ctx.Response.Headers['Access-Control-Allow-Methods'] = 'GET,POST,DELETE,OPTIONS'
			$ctx.Response.Headers['Access-Control-Allow-Headers'] = '*'
			$ctx.Response.Close(); continue
		}

		if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/health')) {
			Send-Json $ctx 200 @{
				success=$true; ok=$true; status='ok'; encoding='ps1-unc-v1'
				clinica='__CLINICA__'; unc=$UncRoot; root=$LocalRoot; port=$Port; maxMb=$MaxMb; auth='tunnel'
				uncReachable = [bool](Test-Path -LiteralPath $UncRoot)
			}
			continue
		}

		if ($method -eq 'GET' -and $path -eq '/file') {
			$pedida = $req.QueryString['path']
			if (-not $pedida) { Send-Json $ctx 400 @{ success=$false; error='path requerido' }; continue }
			$found = Map-Path $pedida
			if (-not $found) { Send-Json $ctx 404 @{ success=$false; error='Archivo no encontrado'; path=(Decode-Path $pedida) }; continue }
			try {
				$bytes = [IO.File]::ReadAllBytes($found)
			} catch {
				Send-Json $ctx 500 @{ success=$false; error=$_.Exception.Message; path=$found }; continue
			}
			$ext = [IO.Path]::GetExtension($found).ToLowerInvariant()
			$map = @{
				'.pdf'='application/pdf'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.png'='image/png'
				'.gif'='image/gif'; '.webp'='image/webp'; '.dcm'='application/dicom'; '.webm'='video/webm'
				'.mp4'='video/mp4'; '.doc'='application/msword'
				'.docx'='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			}
			$ctx.Response.StatusCode = 200
			$ctx.Response.ContentType = $(if ($map.ContainsKey($ext)) { $map[$ext] } else { 'application/octet-stream' })
			$ctx.Response.Headers['Access-Control-Allow-Origin'] = '*'
			$fn = [Uri]::EscapeDataString([IO.Path]::GetFileName($found))
			$ctx.Response.AddHeader('Content-Disposition', "inline; filename*=UTF-8''$fn")
			$ctx.Response.ContentLength64 = $bytes.Length
			$ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
			$ctx.Response.Close()
			continue
		}

		if ($method -eq 'DELETE' -and $path -eq '/file') {
			$found = Map-Path $req.QueryString['path']
			if (-not $found) { Send-Json $ctx 404 @{ success=$false; error='Archivo no encontrado' }; continue }
			[IO.File]::Delete($found)
			Send-Json $ctx 200 @{ success=$true; path=$found; filePath=$found }
			continue
		}

		if ($method -eq 'POST' -and $path -eq '/upload') {
			if ($req.ContentLength64 -gt $MaxBytes) {
				Send-Json $ctx 413 @{ success=$false; error="El archivo supera los $MaxMb MB" }; continue
			}
			$mp = Read-Multipart $req
			if (-not $mp.file) { Send-Json $ctx 400 @{ success=$false; error='Archivo requerido (field: file)' }; continue }
			$dest = if ($mp.fields['path']) { Decode-Path $mp.fields['path'] } else {
				Build-Dest $mp.fields['numeroVisita'] $mp.fields['nombrePaciente'] $mp.file.filename
			}
			$dir = Split-Path $dest -Parent
			New-Item -ItemType Directory -Force -Path $dir | Out-Null
			[IO.File]::WriteAllBytes($dest, $mp.file.bytes)
			Send-Json $ctx 201 @{
				success=$true; ok=$true; path=$dest; filePath=$dest
				originalName=$mp.file.filename; size=$mp.file.bytes.Length
			}
			continue
		}

		Send-Json $ctx 404 @{ success=$false; error='Not found' }
	} catch {
		try { if ($ctx) { Send-Json $ctx 500 @{ success=$false; error=$_.Exception.Message } } } catch {}
		Write-Host "[iMedic FS] error: $($_.Exception.Message)"
	}
}
'@

$FileServerSource = $FileServerSource.
	Replace('__UNC_ROOT__', $UncRoot.Replace("'", "''")).
	Replace('__LOCAL_ROOT__', $LocalRoot.Replace("'", "''")).
	Replace('__CLINICA__', $Clinica)

function Install-FileServer {
	New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
	New-Item -ItemType Directory -Force -Path $LocalRoot -ErrorAction SilentlyContinue | Out-Null
	Set-Content -Path $FsScript -Value $FileServerSource -Encoding UTF8
	Write-Ok "file server en $FsScript"

	Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
	Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
		Where-Object { $_.CommandLine -and $_.CommandLine -like '*file-server.ps1*' } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
	Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
		ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
	Start-Sleep -Seconds 2

	$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$FsScript`" -UncRoot `"$UncRoot`" -LocalRoot `"$LocalRoot`" -Port $Port -MaxMb $MaxMb"
	$action = New-ScheduledTaskAction -Execute $ps -Argument $arg
	$trigLogon = New-ScheduledTaskTrigger -AtLogOn -User $User
	$trigLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
	$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
	# Usuario interactivo: tickets Kerberos/NTLM al share UNC (SYSTEM no llega)
	$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest

	Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigLogon, $trigLoop) `
		-Principal $principal -Settings $settings `
		-Description "File server adjuntos $Clinica (UNC $UncRoot)" | Out-Null
	Start-ScheduledTask -TaskName $TaskName
	Write-Ok "tarea '$TaskName' como $User"
}

function Set-FileServerUrlRemote {
	if (-not $SaUser -or -not $SaPass) {
		Write-Warn "Sin SaPass: en Super Admin > Empresas > $Clinica > FileServerUrl = https://$Hostname"
		return
	}
	Write-Paso 'FileServerUrl en Super Admin (API)'
	try {
		$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/login" -ContentType 'application/json' -Body (@{
			username = $SaUser; password = $SaPass
		} | ConvertTo-Json) -TimeoutSec 30
		$token = $login.token
		if (-not $token) { $token = $login.data.token }
		if (-not $token) { throw "login sin token: $($login | ConvertTo-Json -Compress)" }

		$headers = @{ Authorization = "Bearer $token" }
		Invoke-RestMethod -Method Put -Uri "$ApiBase/super-admin/empresas/$EmpresaId/conexion" `
			-Headers $headers -ContentType 'application/json' `
			-Body (@{ fileServerUrl = "https://$Hostname" } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
		Write-Ok "FileServerUrl = https://$Hostname"
	} catch {
		Write-Warn "No se pudo grabar por API: $($_.Exception.Message)"
		Write-Warn "En Super Admin > Empresas > $Clinica > FileServerUrl = https://$Hostname"
	}
}

# =====================================================================

Write-Host ''
Write-Host "  iMedic clinica: $Clinica" -ForegroundColor White
Write-Host "  https://$Hostname"
Write-Host "  UNC: $UncRoot"
Write-Host "  Local: $LocalRoot"
Write-Host "  Usuario FS: $User"
Write-Host ''

if (Test-Path -LiteralPath $UncRoot) {
	Write-Ok "acceso a $UncRoot"
} else {
	Write-Warn "no se lee $UncRoot con este usuario (abrir Explorador a esa ruta y reintentar)"
}

Write-Paso 'cloudflared'
$Cloudflared = Install-Cloudflared

Write-Paso 'File server local (PowerShell UNC)'
Install-FileServer

$h = $null
foreach ($i in 1..15) {
	Start-Sleep -Seconds 2
	try {
		$h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
		if ($h -and $h.status -eq 'ok') { break }
	} catch { $h = $null }
}

if ($h) {
	Write-Host (($h | ConvertTo-Json -Compress))
	$enc = if ($h.PSObject.Properties['encoding']) { [string]$h.encoding } else { '' }
	if ($enc -ne 'ps1-unc-v1') {
		Write-Warn "health encoding=$enc (esperado ps1-unc-v1); matando puerto y reintento..."
		Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
			ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
		$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
		$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$FsScript`" -UncRoot `"$UncRoot`" -LocalRoot `"$LocalRoot`" -Port $Port -MaxMb $MaxMb"
		Start-Process -FilePath $ps -ArgumentList $arg -WindowStyle Hidden
		Start-Sleep -Seconds 4
		$h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10
		Write-Host (($h | ConvertTo-Json -Compress))
	}
	$uncOk = $false
	if ($h.PSObject.Properties['uncReachable']) { $uncOk = [bool]$h.uncReachable }
	if ($uncOk) { Write-Ok 'file server OK (uncReachable=true)' }
	else { Write-Warn 'file server OK pero uncReachable=false' }
} else {
	Write-Warn 'file server local aun no responde; revisar tarea iMedic File Server'
}

Write-Paso 'Servicio cloudflared'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
	Write-Warn 'Reinstalando servicio...'
	$prev = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	& $Cloudflared service uninstall 2>&1 | ForEach-Object { Write-Host $_ }
	$ErrorActionPreference = $prev
	Start-Sleep -Seconds 2
}

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$out = & $Cloudflared service install $TunnelToken 2>&1
$exit = $LASTEXITCODE
$ErrorActionPreference = $prev
$out | ForEach-Object { Write-Host $_ }

$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if (-not $svc) {
	throw "Fallo cloudflared service install (exit=$exit). Corre como Administrador."
}
Start-Sleep -Seconds 2
& sc.exe config cloudflared start= auto | Out-Null
& sc.exe failure cloudflared reset= 60 actions= restart/5000/restart/5000/restart/10000 | Out-Null
Start-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
	Write-Ok 'cloudflared corriendo (arranque automatico)'
} else {
	Write-Warn "servicio instalado pero status=$($svc.Status). Proba: Start-Service cloudflared"
}

Set-FileServerUrlRemote

Write-Host ''
Write-Host '  LISTO' -ForegroundColor Green
Write-Host "  https://$Hostname" -ForegroundColor Cyan
Write-Host "  Local health: http://127.0.0.1:$Port/health"
Write-Host ''
