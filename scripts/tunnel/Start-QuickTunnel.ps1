#Requires -Version 5.1
<#
  UNICO script de tunel + file server de adjuntos.

  En la PC de la clinica: copiar este archivo a C:\imedic\Start-QuickTunnel.ps1

  Primera vez / URL nueva:
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\imedic\Start-QuickTunnel.ps1

  Solo reiniciar file server (tunel Cloudflare NO cambia):
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\imedic\Start-QuickTunnel.ps1 -KeepTunnel

  Railway usa la URL trycloudflare. 127.0.0.1:9012 es solo local.
#>
param(
	[int] $Port = 9012,
	[string] $Root = 'C:\imedic\adjuntos',
	[int] $EmpresaId = 101,
	[string] $Api = 'https://imedicsaasback-production.up.railway.app/api',
	[string] $SaUser = 'superadmin',
	[string] $SaPass = 'SuperAdmin2026!',
	[switch] $KeepTunnel,
	[switch] $SkipApi
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:LatN = [char]0x00D1
$here = 'C:\imedic'
New-Item -ItemType Directory -Force -Path $here, $Root, "$env:ProgramData\iMedic\adjuntos-tunnel" | Out-Null
$runtime = Join-Path $here 'file-server-runtime.ps1'
$outLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\cf-out.log'
$errLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\cf-err.log'
$urlFile = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\url.txt'
$fsLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\file-server.log'
$fsErrLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\file-server-err.log'

function Get-PidsOnPort([int]$listenPort) {
	$pids = @()
	foreach ($line in (netstat -ano -p tcp)) {
		if ($line -match ":$listenPort\s+.+LISTENING\s+(\d+)\s*$") { $pids += [int]$Matches[1]; continue }
		if ($line -match "\]:$listenPort\s+.+LISTENING\s+(\d+)\s*$") { $pids += [int]$Matches[1] }
	}
	return $pids | Select-Object -Unique
}

function Ensure-HttpUrlAcl([int]$listenPort) {
	$url = "http://127.0.0.1:$listenPort/"
	$show = netsh http show urlacl url=$url 2>&1 | Out-String
	if ($show -notmatch 'URL reservada|Reserved URL') {
		Write-Host "Reservando $url (HttpListener)..."
		$null = netsh http add urlacl url=$url user=Everyone
	}
}

function Show-FileServerDiagnostics {
	$health = Get-HealthJson "http://127.0.0.1:$Port/health"
	Write-Host ''
	Write-Host '--- diagnostico file server ---'
	Write-Host "Health recibido: $(if ($health) { $health } else { '(sin respuesta)' })"
	foreach ($procId in (Get-PidsOnPort $Port)) {
		try {
			$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
			if ($p) { Write-Host "Puerto $Port -> PID $($p.Id) $($p.ProcessName)" }
		} catch {}
	}
	foreach ($logPath in @($fsErrLog, $fsLog)) {
		if (-not (Test-Path -LiteralPath $logPath)) { continue }
		Write-Host "--- $logPath (ultimas lineas) ---"
		Get-Content -LiteralPath $logPath -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
	}
	Write-Host '-----------------------------'
}

function Stop-Port([int]$listenPort) {
	foreach ($procId in (Get-PidsOnPort $listenPort)) {
		if ($procId -le 4) { continue }
		Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
	}
	Start-Sleep -Milliseconds 400
}

function Get-HealthJson([string]$url) {
	try {
		$r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
		return $r.Content
	} catch { return $null }
}

function Test-ImedicFileServer {
	$h = Get-HealthJson "http://127.0.0.1:$Port/health"
	return ($h -and $h -match '"success"\s*:\s*true' -and $h -match '"status"\s*:\s*"ok"' -and $h -match '"encoding"\s*:\s*"utf8-v2"')
}

function Stop-LegacyFileServers {
	Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
		Where-Object { $_.Name -match '^(powershell|pwsh)(\.exe)?$' -and $_.CommandLine -like '*file-server-runtime*' } |
		ForEach-Object {
			Write-Host "Deteniendo file server anterior (PID $($_.ProcessId))..."
			Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
		}
	foreach ($procId in (Get-PidsOnPort $Port)) {
		if ($procId -le 4) { continue }
		try {
			$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
			if ($p -and $p.ProcessName -match 'python|py') {
				Write-Host "Deteniendo file server viejo (Python PID $($p.Id))..."
				Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
			}
		} catch {}
	}
	Stop-Port $Port
}

function Get-UploadFilePathFromJson([string]$txt) {
	$obj = $txt | ConvertFrom-Json
	if ($obj.filePath) { return [string]$obj.filePath }
	if ($obj.path) { return [string]$obj.path }
	throw "Respuesta sin filePath: $txt"
}

function Probe-Utf8Filename {
	$probeStem = 'PE' + $script:LatN + 'A'
	$probeName = $probeStem + '-probe.txt'
	$body = [Text.Encoding]::UTF8.GetBytes("probe $(Get-Date -Format o)")
	$boundary = '----ImedicUtf8' + [guid]::NewGuid().ToString('N')
	$nl = "`r`n"
	$ms = New-Object IO.MemoryStream
	$w = New-Object IO.StreamWriter($ms, [Text.Encoding]::UTF8, 1024, $true)
	$w.Write("--$boundary$nl")
	$w.Write("Content-Disposition: form-data; name=`"numeroVisita`"$nl$nl99999$nl")
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

	$req = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/upload")
	$req.Method = 'POST'
	$req.ContentType = "multipart/form-data; boundary=$boundary"
	$req.Timeout = 15000
	$req.GetRequestStream().Write($payload, 0, $payload.Length)
	$resp = $req.GetResponse()
	$sr = New-Object IO.StreamReader($resp.GetResponseStream())
	$txt = $sr.ReadToEnd()
	$sr.Close(); $resp.Close()
	if ($txt -notmatch 'filePath') { throw "Probe UTF-8 no devolvio filePath: $txt" }
	$mojibakeMark = 'PE' + [char]0x00C3 + [char]0x0091
	if ($txt -like "*$mojibakeMark*" -or $txt -match 'PE.A\?A') {
		throw "Probe UTF-8 fallo: el nombre quedo corrupto ($txt)"
	}
	$fp = (Get-UploadFilePathFromJson $txt).Replace('\\', '\')
	if ($fp -notlike "*$probeStem*") { Write-Host "WARN: filePath sin N-tilde legible -> $fp" }
	try {
		Invoke-WebRequest -Method DELETE -Uri ("http://127.0.0.1:$Port/file?path=" + [uri]::EscapeDataString($fp)) -UseBasicParsing -TimeoutSec 10 | Out-Null
	} catch {}
	Write-Host "Probe UTF-8 OK  $fp"
}

function Find-Cloudflared {
	foreach ($c in @(
			(Join-Path $here 'cloudflared.exe'),
			'C:\Program Files\cloudflared\cloudflared.exe',
			'C:\Program Files (x86)\cloudflared\cloudflared.exe'
		)) {
		if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path }
	}
	$cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	throw 'cloudflared no encontrado. Instala: winget install --id Cloudflare.cloudflared -e'
}

function Write-FileServerRuntime {
	$content = @'
param(
  [Parameter(Mandatory=$true)][int]$Port,
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = "Stop"
$RootDir = $Root
$fsLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\file-server.log'
function FsLog([string]$m) {
  try { Add-Content -LiteralPath $fsLog -Value "$(Get-Date -Format o) $m" -ErrorAction SilentlyContinue } catch {}
}
FsLog "Inicio port=$Port root=$RootDir pid=$PID"
if (-not (Test-Path -LiteralPath $RootDir)) { New-Item -ItemType Directory -Force -Path $RootDir | Out-Null }

function Normalize-Path([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  $x = [Uri]::UnescapeDataString($p)
  if ($x.StartsWith("D:\")) { $x = "E:\" + $x.Substring(3) }
  if ($x.StartsWith("F:\")) { $x = "E:\" + $x.Substring(3) }
  return $x
}
function Sanitize-Name([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return "" }
  $x = $s.Trim().ToUpper()
  $x = $x -replace "[\\/:*?`"<>|]", " "
  $x = $x -replace "\s+", " "
  return $x.Trim()
}
function Repair-Utf8Mojibake([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return $s }
  try {
    $latin1 = [Text.Encoding]::GetEncoding(28591)
    $bytes = $latin1.GetBytes($s)
    $decoded = [Text.Encoding]::UTF8.GetString($bytes)
    if ($decoded.IndexOf([char]0xFFFD) -lt 0 -and $decoded -ne $s) { $s = $decoded }
  } catch {}
  $latN = [char]0x00D1
  $latn = [char]0x00F1
  $s = $s.Replace(([char]0x00C3).ToString() + [char]0x0091, $latN)
  $s = $s.Replace(([char]0x00C3).ToString() + '?', $latN)
  $s = $s.Replace(([char]0x00C3).ToString() + [char]0x00B1, $latn)
  return $s
}
function Sanitize-FileName([string]$fileName) {
  $safeFile = [IO.Path]::GetFileName((Repair-Utf8Mojibake $fileName))
  $safeFile = $safeFile -replace "[\\/:*?`"<>|]", "_"
  $safeFile = $safeFile -replace "[\x00-\x1F]", "_"
  if ([string]::IsNullOrWhiteSpace($safeFile)) { return "archivo" }
  return $safeFile.Trim()
}
function Get-VidalDest([string]$root, [string]$visita, [string]$paciente, [string]$fileName) {
  $safeFile = Sanitize-FileName $fileName
  $n = Sanitize-Name (Repair-Utf8Mojibake $paciente)
  $folder = $null
  if ($visita -and $n) { $folder = "$visita $n" }
  elseif ($visita) { $folder = "$visita" }
  if ($folder) { return (Join-Path (Join-Path $root $folder) $safeFile) }
  return (Join-Path $root $safeFile)
}
function Find-ExistingFile([string]$p) {
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($c in @($p, (Repair-Utf8Mojibake $p))) {
    if ($c -and -not $names.Contains($c)) { [void]$names.Add($c) }
  }
  $fileName = Sanitize-FileName ([IO.Path]::GetFileName($p))
  $dir = [IO.Path]::GetDirectoryName($p)
  if ($dir) { [void]$names.Add((Join-Path $dir $fileName)) }
  [void]$names.Add((Join-Path $RootDir $fileName))
  [void]$names.Add((Join-Path $RootDir ([IO.Path]::GetFileName($p))))
  foreach ($c in $names) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
  }
  $want = $fileName.ToLowerInvariant()
  foreach ($folder in @($dir, $RootDir)) {
    if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue)) {
      $have = (Sanitize-FileName $f.Name).ToLowerInvariant()
      if ($have -eq $want) { return $f.FullName }
    }
  }
  return $null
}
function Ensure-Parent([string]$filePath) {
  $dir = [IO.Path]::GetDirectoryName($filePath)
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}
function Add-Cors($res) {
  $res.Headers["Access-Control-Allow-Origin"] = "*"
  $res.Headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
  $res.Headers["Access-Control-Allow-Headers"] = "*"
}
function Send-Json($res, [int]$code, [string]$json) {
  Add-Cors $res
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $res.StatusCode = $code
  $res.ContentType = "application/json; charset=utf-8"
  $res.ContentLength64 = $bytes.LongLength
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}
function Find-Bytes([byte[]]$arr,[byte[]]$pattern,[int]$start=0) {
  for ($i=$start; $i -le $arr.Length-$pattern.Length; $i++) {
    $ok = $true
    for ($j=0; $j -lt $pattern.Length; $j++) { if ($arr[$i+$j] -ne $pattern[$j]) { $ok=$false; break } }
    if ($ok) { return $i }
  }
  return -1
}
function Parse-Multipart([byte[]]$body,[string]$contentType) {
  $m = [regex]::Match($contentType, "boundary=(.+)$")
  if (-not $m.Success) { throw "Boundary no encontrado" }
  $boundary = $m.Groups[1].Value.Trim('"')
  $b = [Text.Encoding]::ASCII.GetBytes("--" + $boundary)
  $sep = [byte[]](13,10,13,10)
  $parts = @()
  $pos = 0
  while ($true) {
    $bi = Find-Bytes $body $b $pos
    if ($bi -lt 0) { break }
    $after = $bi + $b.Length
    if ($after + 1 -lt $body.Length -and $body[$after] -eq 45 -and $body[$after+1] -eq 45) { break }
    if ($after + 1 -ge $body.Length) { break }
    if ($body[$after] -eq 13 -and $body[$after+1] -eq 10) { $after += 2 }
    $hi = Find-Bytes $body $sep $after
    if ($hi -lt 0) { break }
    $headerText = [Text.Encoding]::UTF8.GetString($body[$after..($hi-1)])
    $dataStart = $hi + 4
    $next = Find-Bytes $body ([byte[]](13,10) + $b) $dataStart
    if ($next -lt 0) { break }
    $dataEnd = $next - 1
    if ($dataEnd -ge $dataStart -and $body[$dataEnd] -eq 10) { $dataEnd-- }
    if ($dataEnd -ge $dataStart -and $body[$dataEnd] -eq 13) { $dataEnd-- }
    $len = [Math]::Max(0, $dataEnd - $dataStart + 1)
    $data = New-Object byte[] $len
    if ($len -gt 0) { [Array]::Copy($body, $dataStart, $data, 0, $len) }
    $parts += [pscustomobject]@{ Headers=$headerText; Data=$data }
    $pos = $next + 2
  }
  return $parts
}
function Mime-Of([string]$filePath) {
  switch ([IO.Path]::GetExtension($filePath).ToLowerInvariant()) {
    ".pdf" { return "application/pdf" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".png" { return "image/png" }
    ".gif" { return "image/gif" }
    default { return "application/octet-stream" }
  }
}

try {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$Port/")
  FsLog "HttpListener.Start en http://127.0.0.1:$Port/"
  $listener.Start()
  FsLog "Escuchando OK"
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $route = $req.Url.AbsolutePath.ToLowerInvariant()
      if ($req.HttpMethod -eq "OPTIONS") { Add-Cors $res; $res.StatusCode = 204; $res.Close(); continue }
      if ($req.HttpMethod -eq "GET" -and ($route -eq "/" -or $route -eq "/health")) {
        $rootEsc = $RootDir.Replace("\","\\")
        Send-Json $res 200 "{""success"":true,""ok"":true,""status"":""ok"",""encoding"":""utf8-v2"",""root"":""$rootEsc"",""port"":$Port}"
        continue
      }
      if ($req.HttpMethod -eq "GET" -and $route -eq "/file") {
        $p = Normalize-Path $req.QueryString["path"]
        if (-not $p) { Send-Json $res 400 "{""success"":false,""error"":""path requerido""}"; continue }
        $found = Find-ExistingFile $p
        if (-not $found) { Send-Json $res 404 "{""success"":false,""error"":""Archivo no encontrado""}"; continue }
        $p = $found
        $bytes = [IO.File]::ReadAllBytes($p)
        Add-Cors $res
        $res.StatusCode = 200
        $res.ContentType = (Mime-Of $p)
        $res.ContentLength64 = $bytes.LongLength
        $res.AddHeader("Content-Disposition", "inline; filename=""" + [IO.Path]::GetFileName($p) + """")
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      }
      if ($req.HttpMethod -eq "POST" -and $route -eq "/upload") {
        $ms = New-Object IO.MemoryStream
        $req.InputStream.CopyTo($ms)
        $body = $ms.ToArray()
        $parts = Parse-Multipart $body $req.ContentType
        $destPath = $null; $numeroVisita = $null; $nombrePaciente = $null; $fileName = $null; [byte[]]$fileBytes = @()
        foreach ($part in $parts) {
          $h = $part.Headers
          $name = [regex]::Match($h, "name=""([^""]+)""").Groups[1].Value
          $fnStar = [regex]::Match($h, "filename\*=(?:UTF-8|utf-8)''([^;\r\n]+)")
          $fn = [regex]::Match($h, "filename=""([^""]*)""").Groups[1].Value
          if ($fnStar.Success) {
            try { $fn = [Uri]::UnescapeDataString($fnStar.Groups[1].Value.Trim()) } catch {}
          }
          if ($fn) { $fileName = Sanitize-FileName $fn; $fileBytes = $part.Data; continue }
          $txt = Repair-Utf8Mojibake ([Text.Encoding]::UTF8.GetString($part.Data).Trim())
          if ($name -eq "path" -and $txt) { $destPath = Normalize-Path $txt }
          if ($name -eq "numeroVisita" -and $txt) { $numeroVisita = $txt }
          if ($name -eq "nombrePaciente" -and $txt) { $nombrePaciente = $txt }
        }
        if (-not $fileName -or $fileBytes.Length -eq 0) { Send-Json $res 400 "{""success"":false,""error"":""archivo requerido""}"; continue }
        if (-not $destPath) { $destPath = Get-VidalDest $RootDir $numeroVisita $nombrePaciente $fileName }
        Ensure-Parent $destPath
        [IO.File]::WriteAllBytes($destPath, $fileBytes)
        $esc = $destPath.Replace("\","\\")
        Send-Json $res 201 "{""success"":true,""ok"":true,""filePath"":""$esc"",""path"":""$esc""}"
        continue
      }
      Send-Json $res 404 "{""success"":false,""error"":""Not found""}"
    } catch {
      $msg = $_.Exception.Message.Replace("\","\\").Replace("""","\""")
      Send-Json $res 500 "{""success"":false,""error"":""$msg""}"
    }
  }
} catch {
  FsLog "FATAL: $($_.Exception.Message)"
  throw
} finally {
  if ($listener -and $listener.IsListening) { $listener.Stop() }
  if ($listener) { $listener.Close() }
}
'@
	$utf8 = New-Object System.Text.UTF8Encoding $false
	[System.IO.File]::WriteAllText($runtime, $content, $utf8)
}

function Start-ImedicFileServer {
	Stop-LegacyFileServers
	Ensure-HttpUrlAcl $Port
	Write-Host 'Reiniciando file server iMedic (utf8-v2, carpetas por visita)...'
	Write-FileServerRuntime
	foreach ($f in @($fsLog, $fsErrLog)) {
		if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
	}
	$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	$args = @(
		'-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runtime,
		'-Port', "$Port", '-Root', $Root
	)
	$proc = Start-Process -FilePath $psExe -ArgumentList $args -WorkingDirectory $here `
		-WindowStyle Hidden -PassThru `
		-RedirectStandardOutput $fsLog -RedirectStandardError $fsErrLog
	$ok = $false
	for ($i = 0; $i -lt 50; $i++) {
		Start-Sleep -Milliseconds 400
		if ($proc.HasExited) { break }
		if (Test-ImedicFileServer) { $ok = $true; break }
	}
	if (-not $ok -and -not $proc.HasExited) {
		Start-Sleep -Seconds 2
		if (Test-ImedicFileServer) { $ok = $true }
	}
	if (-not $ok) {
		Show-FileServerDiagnostics
		if ($proc.HasExited) {
			throw "File server termino con codigo $($proc.ExitCode). Ver $fsErrLog y $fsLog"
		}
		throw "File server iMedic no respondio encoding=utf8-v2 en http://127.0.0.1:$Port/health"
	}
	Probe-Utf8Filename
}

function Save-FileServerUrlRest([string]$publicUrl) {
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$loginBody = (@{ username = $SaUser; password = $SaPass } | ConvertTo-Json)
	$first = Invoke-RestMethod -Uri "$Api/auth/login" -Method POST -ContentType 'application/json; charset=utf-8' -Body $loginBody
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
				if ($n -match 'sarmiento') { $pick = $e; break }
			}
		}
		if (-not $pick) { $pick = @($first.empresas)[0] }
		$idEmp = $pick.idEmpresa; if ($null -eq $idEmp) { $idEmp = $pick.id }
		$second = Invoke-RestMethod -Uri "$Api/auth/login" -Method POST -ContentType 'application/json; charset=utf-8' -Body ((@{
					username  = $SaUser
					password  = $SaPass
					idEmpresa = $idEmp
					tempToken = $first.tempToken
				} | ConvertTo-Json))
		$token = $second.token
	}
	if (-not $token) { throw 'Login Super Admin sin token' }
	Invoke-RestMethod -Uri "$Api/super-admin/empresas/$EmpresaId/conexion" -Method PUT -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json; charset=utf-8' -Body ((@{ fileServerUrl = $publicUrl } | ConvertTo-Json)) | Out-Null
}

Write-Host 'iMedic - file server + tunel'
Write-Host "Root: $Root"
Start-ImedicFileServer
Write-Host "File server OK  http://127.0.0.1:$Port/health  (encoding=utf8-v2)"

if ($KeepTunnel) {
	$url = $null
	if (Test-Path $urlFile) { $url = (Get-Content $urlFile | Select-Object -First 1) }
	Write-Host 'KeepTunnel: cloudflared no se toca.'
	if ($url) { Write-Host $url }
	exit 0
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
$cf = Find-Cloudflared
foreach ($f in @($outLog, $errLog)) { if (Test-Path $f) { Remove-Item $f -Force } }
Write-Host 'Abriendo tunnel Cloudflare...'
$cfProc = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port", '--loglevel', 'info') -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

$url = $null
for ($i = 0; $i -lt 60; $i++) {
	Start-Sleep -Seconds 1
	foreach ($f in @($outLog, $errLog)) {
		if (-not (Test-Path $f)) { continue }
		$m = Select-String -LiteralPath $f -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -Last 1
		if ($m) { $url = $m.Matches[0].Value.TrimEnd('/'); break }
	}
	if ($url) { break }
	if ($cfProc.HasExited) { break }
}
if (-not $url) { throw "No salio la URL trycloudflare. Mira $errLog" }

$url | Set-Content -LiteralPath $urlFile -Encoding ASCII
try { Set-Clipboard -Value $url } catch { }

$apiMsg = 'URL no grabada en Super Admin'
if (-not $SkipApi) {
	try {
		Save-FileServerUrlRest $url
		$apiMsg = "FileServerUrl grabado en empresa $EmpresaId"
	} catch {
		$apiMsg = "No se pudo grabar en Super Admin: $($_.Exception.Message)"
	}
}

Write-Host ''
Write-Host '========================================'
Write-Host "URL: $url"
Write-Host "Archivos: $Root\{visita} {PACIENTE}\archivo"
Write-Host $apiMsg
Write-Host 'La consola se cierra y el tunnel queda corriendo en segundo plano.'
Write-Host '========================================'
exit 0
