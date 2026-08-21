@echo off
setlocal
if not defined PORT set "PORT=9012"
if not defined ROOT set "ROOT=E:\adjuntos"
if not defined FALLBACK_ROOT set "FALLBACK_ROOT=C:\imedic-adjuntos"
set "TMP_PS1=%TEMP%\imedic-file-server-runtime.ps1"

echo ========================================
echo iMedic File Server (rutas como Vidal)
echo ========================================
echo Puerto: %PORT%
echo Root adjuntos: %ROOT%
echo Fallback root: %FALLBACK_ROOT%
echo.
echo Endpoints: GET /health, GET /file, POST /upload, DELETE /file
echo Guardado: ROOT\{visita} {PACIENTE}\archivo
echo.

for /f "tokens=1 delims=:" %%N in ('findstr /n /c:":__POWERSHELL__" "%~f0"') do set /a PS_START=%%N+1
more +%PS_START% "%~f0" > "%TMP_PS1%"
set "FILE_SERVER_PORT=%PORT%"
set "FILE_SERVER_ROOT=%ROOT%"
set "FILE_SERVER_FALLBACK_ROOT=%FALLBACK_ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS1%"
echo.
echo El servidor termino con codigo %ERRORLEVEL%.
del "%TMP_PS1%" >nul 2>&1
if /I not "%IMEDIC_NOPAUSE%"=="1" pause
endlocal
exit /b

:__POWERSHELL__
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Port = [int]$env:FILE_SERVER_PORT
$RootDir = $env:FILE_SERVER_ROOT
$FallbackRootDir = $env:FILE_SERVER_FALLBACK_ROOT
try {
  if (-not (Test-Path -LiteralPath $RootDir)) {
    New-Item -Path $RootDir -ItemType Directory -Force -ErrorAction Stop | Out-Null
  }
} catch {
  Write-Host "WARN: no se pudo usar $RootDir, usando $FallbackRootDir"
  $RootDir = $FallbackRootDir
  if (-not (Test-Path -LiteralPath $RootDir)) {
    New-Item -Path $RootDir -ItemType Directory -Force | Out-Null
  }
}

function Normalize-Path([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  $x = [Uri]::UnescapeDataString($p)
  if ($x.StartsWith('D:\')) { $x = 'E:\' + $x.Substring(3) }
  if ($x.StartsWith('F:\')) { $x = 'E:\' + $x.Substring(3) }
  return $x
}

function Replace-N-Tilde([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return $s }
  try { $s = $s.Normalize([Text.NormalizationForm]::FormC) } catch {}
  $s = $s -replace '[\u00D1\u00F1]', '_'
  $s = $s -replace 'N\u0303', '_'
  $s = $s -replace 'n\u0303', '_'
  return $s
}

function Sanitize-Name([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return '' }
  $x = Replace-N-Tilde (Repair-Utf8Mojibake $s)
  $x = $x.Trim().ToUpper()
  $x = $x -replace '[\\/:*?"<>|]', ' '
  $x = $x -replace '\s+', ' '
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
  $safeFile = Replace-N-Tilde ([IO.Path]::GetFileName((Repair-Utf8Mojibake $fileName)))
  $safeFile = $safeFile -replace '[\\/:*?"<>|]', '_'
  $safeFile = $safeFile -replace '[\x00-\x1F]', '_'
  if ([string]::IsNullOrWhiteSpace($safeFile)) { return 'archivo' }
  return $safeFile.Trim()
}

# Igual que Vidal: \\server\Imagenes\Vidal\{visita} {PACIENTE}\{archivo}
function Get-VidalDest([string]$root, [string]$visita, [string]$paciente, [string]$fileName) {
  $safeFile = Sanitize-FileName $fileName
  $n = Sanitize-Name $paciente
  $folder = $null
  if ($visita -and $n) { $folder = "$visita $n" }
  elseif ($visita) { $folder = "$visita" }
  if ($folder) { return (Join-Path (Join-Path $root $folder) $safeFile) }
  return (Join-Path $root $safeFile)
}

function Find-ExistingFile([string]$p) {
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($c in @($p, (Repair-Utf8Mojibake $p), (Replace-N-Tilde $p), (Replace-N-Tilde (Repair-Utf8Mojibake $p)))) {
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
  $dir = [System.IO.Path]::GetDirectoryName($filePath)
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -Path $dir -ItemType Directory -Force | Out-Null
  }
}

function Add-Cors($res) {
  $res.Headers['Access-Control-Allow-Origin'] = '*'
  $res.Headers['Access-Control-Allow-Methods'] = 'GET,POST,DELETE,OPTIONS'
  $res.Headers['Access-Control-Allow-Headers'] = '*'
}

function Send-Json($res, [int]$code, [string]$json) {
  Add-Cors $res
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $res.StatusCode = $code
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $bytes.LongLength
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}

function Find-Bytes([byte[]]$arr,[byte[]]$pattern,[int]$start=0) {
  for ($i=$start; $i -le $arr.Length-$pattern.Length; $i++) {
    $ok = $true
    for ($j=0; $j -lt $pattern.Length; $j++) {
      if ($arr[$i+$j] -ne $pattern[$j]) { $ok=$false; break }
    }
    if ($ok) { return $i }
  }
  return -1
}

function Parse-Multipart([byte[]]$body,[string]$contentType) {
  $m = [regex]::Match($contentType, 'boundary=(.+)$')
  if (-not $m.Success) { throw 'Boundary no encontrado en multipart/form-data' }
  $boundary = $m.Groups[1].Value.Trim('"')
  $b = [Text.Encoding]::ASCII.GetBytes('--' + $boundary)
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
    $headerBytes = $body[$after..($hi-1)]
    $headerText = [Text.Encoding]::UTF8.GetString($headerBytes)
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
    '.pdf'  { return 'application/pdf' }
    '.jpg'  { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.png'  { return 'image/png' }
    '.gif'  { return 'image/gif' }
    '.dcm'  { return 'application/dicom' }
    '.webm' { return 'video/webm' }
    '.mp4'  { return 'video/mp4' }
    default { return 'application/octet-stream' }
  }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host "Servidor activo en http://127.0.0.1:$Port"
Write-Host "Root de archivos: $RootDir"
Write-Host "Ruta Vidal: $RootDir\{visita} {PACIENTE}\archivo"
Write-Host "Ctrl+C para detener."

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $route = $req.Url.AbsolutePath.ToLowerInvariant()

      if ($req.HttpMethod -eq 'OPTIONS') {
        Add-Cors $res
        $res.StatusCode = 204
        $res.Close()
        continue
      }

      if ($req.HttpMethod -eq 'GET' -and ($route -eq '/' -or $route -eq '/health')) {
        $rootEsc = $RootDir.Replace('\','\\')
        Send-Json $res 200 "{""success"":true,""status"":""ok"",""encoding"":""utf8-v2"",""root"":""$rootEsc"",""port"":$Port,""endpoints"":[""/health"",""/file"",""/upload""]}"
        continue
      }

      if ($req.HttpMethod -eq 'GET' -and $route -eq '/file') {
        $p = Normalize-Path $req.QueryString['path']
        if (-not $p) { Send-Json $res 400 '{"success":false,"error":"path requerido"}'; continue }
        $found = Find-ExistingFile $p
        if (-not $found) { Send-Json $res 404 '{"success":false,"error":"Archivo no encontrado"}'; continue }
        $p = $found
        $bytes = [IO.File]::ReadAllBytes($p)
        Add-Cors $res
        $res.StatusCode = 200
        $res.ContentType = (Mime-Of $p)
        $res.ContentLength64 = $bytes.LongLength
        $res.AddHeader('Content-Disposition', 'inline; filename="' + [IO.Path]::GetFileName($p) + '"')
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      }

      if ($req.HttpMethod -eq 'DELETE' -and $route -eq '/file') {
        $p = Normalize-Path $req.QueryString['path']
        if (-not $p) { Send-Json $res 400 '{"success":false,"error":"path requerido"}'; continue }
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Send-Json $res 404 '{"success":false,"error":"Archivo no encontrado"}'; continue }
        Remove-Item -LiteralPath $p -Force
        $esc = $p.Replace('\','\\')
        Send-Json $res 200 "{""success"":true,""filePath"":""$esc""}"
        continue
      }

      if ($req.HttpMethod -eq 'POST' -and $route -eq '/upload') {
        $ms = New-Object IO.MemoryStream
        $req.InputStream.CopyTo($ms)
        $body = $ms.ToArray()
        $parts = Parse-Multipart $body $req.ContentType

        $destPath = $null
        $numeroVisita = $null
        $nombrePaciente = $null
        $fileName = $null
        [byte[]]$fileBytes = @()

        foreach ($part in $parts) {
          $h = $part.Headers
          $name = [regex]::Match($h, 'name="([^"]+)"').Groups[1].Value
          $fnStar = [regex]::Match($h, "filename\*=(?:UTF-8|utf-8)''([^;\r\n]+)")
          $fn = [regex]::Match($h, 'filename="([^"]*)"').Groups[1].Value
          if ($fnStar.Success) {
            try { $fn = [Uri]::UnescapeDataString($fnStar.Groups[1].Value.Trim()) } catch {}
          }

          if ($fn) {
            $fileName = Sanitize-FileName $fn
            $fileBytes = $part.Data
            continue
          }

          $txt = [Text.Encoding]::UTF8.GetString($part.Data).Trim()
          $txt = Repair-Utf8Mojibake $txt
          if ($name -eq 'path' -and $txt) { $destPath = Normalize-Path $txt }
          if ($name -eq 'numeroVisita' -and $txt) { $numeroVisita = $txt }
          if ($name -eq 'nombrePaciente' -and $txt) { $nombrePaciente = $txt }
        }

        if (-not $fileName -or $fileBytes.Length -eq 0) { Send-Json $res 400 '{"success":false,"error":"archivo requerido"}'; continue }
        if (-not $destPath) {
          $destPath = Get-VidalDest $RootDir $numeroVisita $nombrePaciente $fileName
        } else {
          $destPath = Replace-N-Tilde (Repair-Utf8Mojibake $destPath)
        }
        $destPath = Replace-N-Tilde $destPath

        Ensure-Parent $destPath
        [IO.File]::WriteAllBytes($destPath, $fileBytes)

        $esc = $destPath.Replace('\','\\')
        Send-Json $res 201 "{""success"":true,""ok"":true,""filePath"":""$esc"",""path"":""$esc""}"
        continue
      }

      Send-Json $res 404 '{"success":false,"error":"Not found"}'
    } catch {
      $msg = $_.Exception.Message.Replace('\','\\').Replace('"','\"')
      Send-Json $res 500 "{""success"":false,""error"":""$msg""}"
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
