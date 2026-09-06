#Requires -RunAsAdministrator
<#
  Parche Vidal: los adjuntos estan en \\server\Imagenes\Vidal\...
  El servicio anterior corria como SYSTEM y no podia leer el share.
  Este script reinstala el file server como el usuario actual (con acceso a red).
#>
param(
	[string]$UncRoot = '\\server\Imagenes\Vidal',
	[string]$LocalRoot = 'E:\adjuntos',
	[int]$Port = 9012
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Off
$InstallDir = 'C:\ProgramData\iMedic'
$FsScript = Join-Path $InstallDir 'file-server.ps1'
$TaskName = 'iMedic File Server'
$User = "$env:USERDOMAIN\$env:USERNAME"

Write-Host "Usuario del servicio: $User"
Write-Host "UNC: $UncRoot"
Write-Host "Local fallback: $LocalRoot"

# Probar acceso al share
if (Test-Path -LiteralPath $UncRoot) {
	Write-Host "OK acceso a $UncRoot" -ForegroundColor Green
} else {
	Write-Host "AVISO: no se puede leer $UncRoot con este usuario. Revisar red/credenciales." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$FileServerSource = @'
param(
	[string]$UncRoot = '\\server\Imagenes\Vidal',
	[string]$LocalRoot = 'E:\adjuntos',
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
	# Normalizar separadores
	$p = $p -replace '/', '\'
	# Colapsar barras de UNC mal escapadas: \\\\server -> \\server
	while ($p -match '^\\\\\\+') { $p = $p -replace '^\\\\', '\' }
	if ($p -match '^[Dd]:\\') { $p = 'E:\' + $p.Substring(3) }
	if ($p -match '^[Ff]:\\') { $p = 'E:\' + $p.Substring(3) }
	return $p
}

function Map-Path([string]$p) {
	$p = Decode-Path $p
	if (-not $p) { return $null }
	# Ya es accesible
	if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
	# \\server\Imagenes\Vidal\... -> intentar tal cual (share)
	if ($p -like '\\*') {
		if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
		# Relativo al UncRoot
		$uncNorm = $UncRoot.TrimEnd('\')
		if ($p.StartsWith($uncNorm, [StringComparison]::OrdinalIgnoreCase)) {
			if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
		}
	}
	# Fallback: mismo relativo bajo LocalRoot
	$uncNorm = $UncRoot.TrimEnd('\')
	if ($p.StartsWith($uncNorm, [StringComparison]::OrdinalIgnoreCase)) {
		$rel = $p.Substring($uncNorm.Length).TrimStart('\')
		$local = Join-Path $LocalRoot $rel
		if (Test-Path -LiteralPath $local -PathType Leaf) { return $local }
	}
	# Solo nombre de archivo en LocalRoot
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
				unc=$UncRoot; root=$LocalRoot; port=$Port; maxMb=$MaxMb; auth='tunnel'
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

Set-Content -Path $FsScript -Value $FileServerSource -Encoding UTF8

# Matar listener viejo (tarea + procesos en el puerto)
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
	Where-Object { $_.CommandLine -and ($_.CommandLine -like '*file-server.ps1*' -or $_.CommandLine -like "*:$Port*") } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
	ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$FsScript`" -UncRoot `"$UncRoot`" -LocalRoot `"$LocalRoot`" -Port $Port"
$action = New-ScheduledTaskAction -Execute $ps -Argument $arg
$trigLogon = New-ScheduledTaskTrigger -AtLogOn -User $User
$trigLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

# Corre como el usuario interactivo (tiene tickets Kerberos/NTLM al share)
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigLogon, $trigLoop) `
	-Principal $principal -Settings $settings `
	-Description "File server adjuntos Vidal (UNC $UncRoot)" | Out-Null

Start-ScheduledTask -TaskName $TaskName

$h = $null
foreach ($i in 1..15) {
	Start-Sleep -Seconds 2
	try {
		$h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
		if ($h -and $h.status -eq 'ok') { break }
	} catch { $h = $null }
}

Write-Host (($h | ConvertTo-Json -Compress))
$enc = if ($h -and $h.PSObject.Properties['encoding']) { [string]$h.encoding } else { '' }
$uncOk = $false
if ($h -and $h.PSObject.Properties['uncReachable']) { $uncOk = [bool]$h.uncReachable }

if ($enc -ne 'ps1-unc-v1') {
	Write-Host "Todavia responde el file server viejo (encoding=$enc). Mato procesos y reintento manual..." -ForegroundColor Yellow
	Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
		ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
	Start-Process -FilePath $ps -ArgumentList $arg -WindowStyle Hidden
	Start-Sleep -Seconds 4
	$h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10
	Write-Host (($h | ConvertTo-Json -Compress))
	$enc = if ($h -and $h.PSObject.Properties['encoding']) { [string]$h.encoding } else { '' }
	$uncOk = $false
	if ($h -and $h.PSObject.Properties['uncReachable']) { $uncOk = [bool]$h.uncReachable }
}

if ($enc -eq 'ps1-unc-v1' -and $uncOk) {
	Write-Host 'LISTO. Proba un adjunto en la web.' -ForegroundColor Green
} elseif ($enc -eq 'ps1-unc-v1') {
	Write-Host "uncReachable=false: abrí el Explorador en $UncRoot y volvé a correr." -ForegroundColor Yellow
} else {
	Write-Host "Fallo: health no es ps1-unc-v1. Revisá C:\ProgramData\iMedic\file-server.ps1" -ForegroundColor Red
}
