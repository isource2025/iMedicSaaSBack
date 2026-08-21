#Requires -Version 5.1
<#
  Configura TODO el tunel de adjuntos (como Vidal):
    - Asegura E:\adjuntos (si no hay E:, subst a C:\imedic)
    - Reemplaza el stub del puerto 9012 por el file server iMedic
    - Guarda en E:\adjuntos\{visita} {PACIENTE}\archivo
  Abre Cloudflare trycloudflare, graba FileServerUrl (Sarmiento 101) y SALE.
  File server + cloudflared quedan en segundo plano (no dependen de esta consola).
  Railway usa SOLO la URL trycloudflare, nunca 127.0.0.1 ni la IP de la PC.

  powershell -NoProfile -ExecutionPolicy Bypass -File "...\Start-QuickTunnel.ps1"
#>
param(
	[int] $Port = 9012,
	[string] $Root = 'E:\adjuntos',
	[string] $FallbackRoot = 'C:\imedic\adjuntos',
	[int] $EmpresaId = 101,
	[string] $EmpresaMatch = 'sarmiento',
	[switch] $SkipApi,
	# Reemplaza el file server del 9012 y NO toca cloudflared ni la URL (para cuando el tunel ya anda).
	[switch] $KeepTunnel
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:LatN = [char]0x00D1
$repoBack = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Find-Cloudflared {
	foreach ($c in @(
			(Join-Path $repoBack 'cloudflared.exe'),
			'C:\Program Files\cloudflared\cloudflared.exe',
			'C:\Program Files (x86)\cloudflared\cloudflared.exe'
		)) {
		if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path }
	}
	$cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	throw 'cloudflared no encontrado. Instala: winget install --id Cloudflare.cloudflared -e'
}

function Get-PidsOnPort([int]$listenPort) {
	$pids = @()
	foreach ($line in (netstat -ano -p tcp)) {
		if ($line -match ":$listenPort\s+.+LISTENING\s+(\d+)\s*$") {
			$pids += [int]$Matches[1]
		}
	}
	return $pids | Select-Object -Unique
}

function Get-Health([int]$listenPort) {
	try {
		$r = Invoke-WebRequest -Uri "http://127.0.0.1:$listenPort/health" -UseBasicParsing -TimeoutSec 3
		return $r.Content
	} catch { return $null }
}

function Test-ImedicFileServer([int]$listenPort) {
	$h = Get-Health $listenPort
	return ($h -and $h -match '"status"\s*:\s*"ok"' -and $h -match '"success"\s*:\s*true' -and $h -match '"encoding"\s*:\s*"utf8-v2"')
}

function Stop-LegacyFileServers([int]$listenPort) {
	foreach ($procId in (Get-PidsOnPort $listenPort)) {
		if ($procId -le 4) { continue }
		try {
			$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
			if ($p -and $p.ProcessName -match 'python|py') {
				Write-Host "Deteniendo file server viejo (Python PID $($p.Id))..."
				Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
			}
		} catch {}
	}
	Stop-Port $listenPort
}

function Ensure-AdjuntosRoot([string]$wanted) {
	if (Test-Path -LiteralPath $wanted) { return (Resolve-Path $wanted).Path }
	$drive = [IO.Path]::GetPathRoot($wanted)
	if ($drive -and -not (Test-Path -LiteralPath $drive)) {
		$hostDir = 'C:\imedic'
		New-Item -ItemType Directory -Force -Path $hostDir | Out-Null
		Write-Host ('No hay ' + $drive + ' - subst ' + $drive + ' -> ' + $hostDir + ' (misma ruta logica que Vidal: E:\adjuntos)')
		cmd /c "subst $($drive.TrimEnd('\')) `"$hostDir`"" | Out-Null
	}
	try {
		New-Item -ItemType Directory -Force -Path $wanted | Out-Null
		return (Resolve-Path $wanted).Path
	} catch {
		Write-Host "WARN: no se pudo crear $wanted, usando $FallbackRoot"
		New-Item -ItemType Directory -Force -Path $FallbackRoot | Out-Null
		return (Resolve-Path $FallbackRoot).Path
	}
}

function Stop-Port([int]$listenPort) {
	foreach ($procId in (Get-PidsOnPort $listenPort)) {
		if ($procId -le 4) { continue }
		Write-Host "Liberando puerto $listenPort (PID $procId)"
		Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
	}
	Start-Sleep -Milliseconds 400
}

function Get-TunnelUrlFromLogs([string[]]$files) {
	foreach ($f in $files) {
		if (-not (Test-Path -LiteralPath $f)) { continue }
		$m = Select-String -LiteralPath $f -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
			Select-Object -Last 1
		if ($m) { return $m.Matches[0].Value.TrimEnd('/') }
	}
	return $null
}

function Save-FileServerUrlRest([string]$publicUrl) {
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$api = 'https://imedicsaasback-production.up.railway.app/api'
	$loginBody = (@{ username = 'superadmin'; password = 'SuperAdmin2026!' } | ConvertTo-Json)
	$first = Invoke-RestMethod -Uri "$api/auth/login" -Method POST -ContentType 'application/json; charset=utf-8' -Body $loginBody
	$token = $first.token
	if (-not $token -and $first.step -eq 'SELECT_EMPRESA') {
		$pick = $null
		foreach ($e in @($first.empresas)) {
			$id = $e.idEmpresa; if ($null -eq $id) { $id = $e.id }
			if ([int]$id -eq $EmpresaId) { $pick = $e; break }
		}
		if (-not $pick) {
			foreach ($e in @($first.empresas)) {
				$n = [string]($e.descripcion + ' ' + $e.nombre)
				if ($n -match $EmpresaMatch) { $pick = $e; break }
			}
		}
		if (-not $pick) { $pick = @($first.empresas)[0] }
		$idEmp = $pick.idEmpresa; if ($null -eq $idEmp) { $idEmp = $pick.id }
		$second = Invoke-RestMethod -Uri "$api/auth/login" -Method POST -ContentType 'application/json; charset=utf-8' -Body ((@{
					username  = 'superadmin'
					password  = 'SuperAdmin2026!'
					idEmpresa = $idEmp
					tempToken = $first.tempToken
				} | ConvertTo-Json))
		$token = $second.token
	}
	if (-not $token) { throw 'Login Super Admin sin token' }
	Invoke-RestMethod -Uri "$api/super-admin/empresas/$EmpresaId/conexion" -Method PUT -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json; charset=utf-8' -Body ((@{ fileServerUrl = $publicUrl } | ConvertTo-Json)) | Out-Null
}

function Test-PublicHealth([string]$base) {
	try {
		$r = Invoke-WebRequest -Uri "$base/health" -UseBasicParsing -TimeoutSec 15
		return ($r.StatusCode -eq 200 -and $r.Content -match '"status"\s*:\s*"ok"')
	} catch {
		return $false
	}
}

function Get-UploadFilePathFromJson([string]$txt) {
	$obj = $txt | ConvertFrom-Json
	if ($obj.filePath) { return [string]$obj.filePath }
	if ($obj.path) { return [string]$obj.path }
	throw "Respuesta sin filePath: $txt"
}

function Probe-Local([int]$listenPort, [string]$rootDir) {
	$probeStem = 'PE' + $script:LatN + 'A'
	$probeName = $probeStem + '-probe.txt'
	$body = [Text.Encoding]::UTF8.GetBytes("probe $(Get-Date -Format o)")
	$boundary = '----ImedicProbe' + [guid]::NewGuid().ToString('N')
	$nl = "`r`n"
	$ms = New-Object IO.MemoryStream
	$w = New-Object IO.StreamWriter($ms, [Text.Encoding]::UTF8, 1024, $true)
	$w.Write("--$boundary$nl")
	$w.Write("Content-Disposition: form-data; name=`"numeroVisita`"$nl$nlPROBE$nl")
	$w.Write("--$boundary$nl")
	$w.Write("Content-Disposition: form-data; name=`"nombrePaciente`"$nl$nl$probeStem PROBE$nl")
	$w.Write("--$boundary$nl")
	$enc = [Uri]::EscapeDataString($probeName)
	$w.Write("Content-Disposition: form-data; name=`"file`"; filename=`"$probeName`"; filename*=UTF-8''$enc$nl")
	$w.Write("Content-Type: text/plain$nl$nl")
	$w.Flush()
	$ms.Write($body, 0, $body.Length)
	$tail = [Text.Encoding]::UTF8.GetBytes("$nl--$boundary--$nl")
	$ms.Write($tail, 0, $tail.Length)
	$payload = $ms.ToArray()
	$w.Dispose(); $ms.Dispose()

	$req = [Net.HttpWebRequest]::Create("http://127.0.0.1:$listenPort/upload")
	$req.Method = 'POST'
	$req.ContentType = "multipart/form-data; boundary=$boundary"
	$req.Timeout = 15000
	$req.ReadWriteTimeout = 15000
	$req.GetRequestStream().Write($payload, 0, $payload.Length)
	$resp = $req.GetResponse()
	$sr = New-Object IO.StreamReader($resp.GetResponseStream())
	$txt = $sr.ReadToEnd()
	$sr.Close(); $resp.Close()
	if ($txt -notmatch 'filePath') { throw "Probe upload no devolvio filePath: $txt" }
	$mojibakeMark = 'PE' + [char]0x00C3 + [char]0x0091
	if ($txt -like "*$mojibakeMark*" -or $txt -match 'PE.A\?A') {
		throw "Probe UTF-8 fallo: nombre corrupto ($txt)"
	}
	$fp = (Get-UploadFilePathFromJson $txt).Replace('\\', '\')
	if ($fp -notlike "$rootDir*") {
		Write-Host "WARN: filePath fuera de $rootDir -> $fp"
	}
	$get = Invoke-WebRequest -Uri ("http://127.0.0.1:$listenPort/file?path=" + [uri]::EscapeDataString($fp)) -UseBasicParsing -TimeoutSec 10
	if ($get.StatusCode -ne 200 -or $get.RawContentLength -lt 1) { throw "Probe GET /file fallo" }
	try {
		Invoke-WebRequest -Method DELETE -Uri ("http://127.0.0.1:$listenPort/file?path=" + [uri]::EscapeDataString($fp)) -UseBasicParsing -TimeoutSec 10 | Out-Null
	} catch { }
	Write-Host "Probe OK  guardo como Vidal: $fp"
}

$logDir = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'cf-out.log'
$errLog = Join-Path $logDir 'cf-err.log'
$urlFile = Join-Path $logDir 'url.txt'

Write-Host 'iMedic — tunel de adjuntos (misma ruta que Vidal)'
Write-Host "Puerto: $Port"
Write-Host ''

$Root = Ensure-AdjuntosRoot $Root
Write-Host "Root: $Root"
Write-Host 'Ejemplo: E:\adjuntos\468 APELLIDO NOMBRE\archivo.pdf'
Write-Host ''

if (-not (Test-ImedicFileServer $Port)) {
	Write-Host 'Reiniciando file server iMedic (utf8-v2)...'
}
Stop-LegacyFileServers $Port
$fsBat = Join-Path $repoBack 'start-file-server.bat'
if (-not (Test-Path -LiteralPath $fsBat)) { throw "No existe $fsBat" }
Write-Host 'Arrancando file server iMedic (oculto)...'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "$env:SystemRoot\System32\cmd.exe"
$psi.Arguments = "/c `"$fsBat`""
$psi.WorkingDirectory = $repoBack
$psi.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables['PORT'] = "$Port"
$psi.EnvironmentVariables['ROOT'] = $Root
$psi.EnvironmentVariables['FALLBACK_ROOT'] = $FallbackRoot
$psi.EnvironmentVariables['IMEDIC_NOPAUSE'] = '1'
[void][Diagnostics.Process]::Start($psi)

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
	Start-Sleep -Milliseconds 400
	if (Test-ImedicFileServer $Port) { $ok = $true; break }
}
if (-not $ok) { throw "El file server iMedic no respondio encoding=utf8-v2 en http://127.0.0.1:$Port/health" }

Write-Host "File server iMedic OK  http://127.0.0.1:$Port/health"
Probe-Local $Port $Root

if ($KeepTunnel) {
	$existing = $null
	if (Test-Path -LiteralPath $urlFile) { $existing = (Get-Content -LiteralPath $urlFile -ErrorAction SilentlyContinue | Select-Object -First 1) }
	Write-Host ''
	Write-Host 'KeepTunnel: cloudflared NO se reinicia. Misma URL publica.'
	if ($existing) { Write-Host $existing }
	Write-Host "Local 127.0.0.1:$Port/health tiene que tener success=true (si no, Railway dice Error al subir archivo al servidor)."
	exit 0
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

Write-Host 'Abriendo tunel Cloudflare... (puede tardar ~20 s)'
$cf = Find-Cloudflared
foreach ($f in @($outLog, $errLog)) { if (Test-Path $f) { Remove-Item $f -Force } }

$cfProc = Start-Process -FilePath $cf -ArgumentList @(
	'tunnel', '--url', "http://127.0.0.1:$Port", '--loglevel', 'info'
) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

$url = $null
for ($i = 0; $i -lt 60; $i++) {
	Start-Sleep -Seconds 1
	$url = Get-TunnelUrlFromLogs @($outLog, $errLog)
	if ($url) { break }
	if ($cfProc.HasExited) { break }
}

if (-not $url) {
	throw "No salio la URL trycloudflare. Mira:`n$errLog`n$outLog"
}

Write-Host "Tunel: $url"
Write-Host 'Esperando health PUBLICO (Railway usa esta URL, no 127.0.0.1 ni la IP de la PC)...'
$publicOk = $false
for ($i = 0; $i -lt 25; $i++) {
	if ($cfProc.HasExited) { throw "cloudflared se cerro antes de quedar online. Mira:`n$errLog" }
	if (Test-PublicHealth $url) { $publicOk = $true; break }
	Start-Sleep -Seconds 2
}
if (-not $publicOk) {
	Write-Host "WARN: $url/health todavia no responde status=ok. Se graba igual; si el upload da 530, volve a correr este script."
}

$url | Set-Content -LiteralPath $urlFile -Encoding ASCII
try { Set-Clipboard -Value $url } catch { }

$apiMsg = 'no se grabo en Super Admin'
if (-not $SkipApi) {
	$node = Get-Command node -ErrorAction SilentlyContinue
	$setJs = Join-Path $PSScriptRoot 'set-fileserver-url.js'
	if ($node -and (Test-Path $setJs)) {
		$p = Start-Process -FilePath $node.Source -ArgumentList @(
			$setJs, '--id', "$EmpresaId", '--url', $url, '--match', $EmpresaMatch
		) -WorkingDirectory $repoBack -Wait -PassThru -NoNewWindow
		if ($p.ExitCode -eq 0) {
			$apiMsg = "FileServerUrl grabado en empresa $EmpresaId"
		} else {
			$apiMsg = "No se pudo grabar en Super Admin (exit $($p.ExitCode)). Pega la URL a mano."
		}
	} else {
		try {
			Save-FileServerUrlRest $url
			$apiMsg = "FileServerUrl grabado en empresa $EmpresaId (sin Node)"
		} catch {
			$apiMsg = "No se pudo grabar en Super Admin: $($_.Exception.Message)"
		}
	}
}

Write-Host ''
Write-Host $url
Write-Host $apiMsg
Write-Host "Local 127.0.0.1:$Port/health = file server en ESTA PC. Railway usa solo el tunel de arriba."
Write-Host 'Consola cierra. File server y cloudflared siguen en segundo plano.'
exit 0
