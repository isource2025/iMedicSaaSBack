#Requires -Version 5.1
<#
  Copiar ESTE archivo a C:\imedic\Start-QuickTunnel.ps1 (reemplaza el de la otra IA).

  Primera vez / URL nueva:
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\imedic\Start-QuickTunnel.ps1

  El tunel ya esta y solo hay que arreglar el file server (NO cambia la URL):
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\imedic\Start-QuickTunnel.ps1 -KeepTunnel

  Graba FileServerUrl en Super Admin con Invoke-RestMethod (no hace falta Node).
  Railway usa esa URL. 127.0.0.1:9012 es solo local.
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
$here = 'C:\imedic'
New-Item -ItemType Directory -Force -Path $here, $Root, "$env:ProgramData\iMedic\adjuntos-tunnel" | Out-Null
$runtime = Join-Path $here 'file-server-runtime.ps1'
$outLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\cf-out.log'
$errLog = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\cf-err.log'
$urlFile = Join-Path $env:ProgramData 'iMedic\adjuntos-tunnel\url.txt'

function Get-PidsOnPort([int]$listenPort) {
	$pids = @()
	foreach ($line in (netstat -ano -p tcp)) {
		if ($line -match ":$listenPort\s+.+LISTENING\s+(\d+)\s*$") { $pids += [int]$Matches[1] }
	}
	return $pids | Select-Object -Unique
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
	return ($h -and $h -match '"success"\s*:\s*true' -and $h -match '"status"\s*:\s*"ok"')
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
	@'
$ErrorActionPreference = "Stop"
$Port = [int]$env:FILE_SERVER_PORT
$RootDir = $env:FILE_SERVER_ROOT
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
  $s = $s.Replace(("$([char]0x00C3)$([char]0x0091)"), "Ñ")
  $s = $s -replace "Ã\?","Ñ"
  $s = $s -replace "Ã‘","Ñ"
  $s = $s -replace "Ã±","ñ"
  $s = $s -replace "Ã¡","á"
  $s = $s -replace "Ã©","é"
  $s = $s -replace "Ã­","í"
  $s = $s -replace "Ã³","ó"
  $s = $s -replace "Ãº","ú"
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

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $route = $req.Url.AbsolutePath.ToLowerInvariant()
      if ($req.HttpMethod -eq "OPTIONS") { Add-Cors $res; $res.StatusCode = 204; $res.Close(); continue }
      if ($req.HttpMethod -eq "GET" -and ($route -eq "/" -or $route -eq "/health")) {
        $rootEsc = $RootDir.Replace("\","\\")
        Send-Json $res 200 "{""success"":true,""ok"":true,""status"":""ok"",""root"":""$rootEsc"",""port"":$Port}"
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
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
'@ | Set-Content -LiteralPath $runtime -Encoding UTF8
}

function Start-ImedicFileServer {
	if (Test-ImedicFileServer) { return }
	Write-Host 'Reemplazando file server del puerto 9012 (el actual no manda success=true)...'
	Stop-Port $Port
	Write-FileServerRuntime
	$psi = New-Object System.Diagnostics.ProcessStartInfo
	$psi.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runtime`""
	$psi.WorkingDirectory = $here
	$psi.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
	$psi.UseShellExecute = $false
	$psi.CreateNoWindow = $true
	$psi.EnvironmentVariables['FILE_SERVER_PORT'] = "$Port"
	$psi.EnvironmentVariables['FILE_SERVER_ROOT'] = $Root
	[void][Diagnostics.Process]::Start($psi)
	$ok = $false
	for ($i = 0; $i -lt 40; $i++) {
		Start-Sleep -Milliseconds 300
		if (Test-ImedicFileServer) { $ok = $true; break }
	}
	if (-not $ok) { throw "File server iMedic no respondio success=true en http://127.0.0.1:$Port/health" }
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

Write-Host 'iMedic Sarmiento — file server + tunel'
Write-Host "Root: $Root"
Start-ImedicFileServer
Write-Host "File server OK  http://127.0.0.1:$Port/health  (success=true)"

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
