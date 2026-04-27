@echo off
setlocal
set "PORT=9012"
set "ROOT=E:\adjuntos"
set "FALLBACK_ROOT=C:\imedic-adjuntos"
set "TMP_PS1=%TEMP%\imedic-file-server-runtime.ps1"

echo ========================================
echo iMedic File Server Standalone
echo ========================================
echo Puerto: %PORT%
echo Root adjuntos: %ROOT%
echo Fallback root: %FALLBACK_ROOT%
echo.
echo Endpoints: GET /health, GET /file, POST /upload, DELETE /file
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
pause
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
    New-Item -Path $RootDir -ItemType Directory -Force -ErrorAction Stop | Out-Null
  }
}

function Normalize-Path([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  $x = [Uri]::UnescapeDataString($p)
  if ($x.StartsWith('D:\')) { $x = 'E:\' + $x.Substring(3) }
  if ($x.StartsWith('F:\')) { $x = 'E:\' + $x.Substring(3) }
  return $x
}

function Ensure-Parent([string]$filePath) {
  $dir = [System.IO.Path]::GetDirectoryName($filePath)
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -Path $dir -ItemType Directory -Force | Out-Null
  }
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

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host "Servidor activo en http://127.0.0.1:$Port"
Write-Host "Root de archivos: $RootDir"
Write-Host "Ctrl+C para detener."

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $route = $req.Url.AbsolutePath.ToLowerInvariant()

      if ($req.HttpMethod -eq 'GET' -and $route -eq '/health') {
        $json = [Text.Encoding]::UTF8.GetBytes('{"success":true,"status":"ok"}')
        $res.StatusCode = 200
        $res.ContentType = 'application/json'
        $res.OutputStream.Write($json,0,$json.Length)
        $res.Close()
        continue
      }

      if ($req.HttpMethod -eq 'GET' -and $route -eq '/file') {
        $p = Normalize-Path $req.QueryString['path']
        if (-not $p) { $res.StatusCode = 400; $res.Close(); continue }
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { $res.StatusCode = 404; $res.Close(); continue }
        $bytes = [IO.File]::ReadAllBytes($p)
        $res.StatusCode = 200
        $res.ContentType = 'application/octet-stream'
        $res.ContentLength64 = $bytes.LongLength
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      }

      if ($req.HttpMethod -eq 'DELETE' -and $route -eq '/file') {
        $p = Normalize-Path $req.QueryString['path']
        if (-not $p) { $res.StatusCode = 400; $res.Close(); continue }
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { $res.StatusCode = 404; $res.Close(); continue }
        Remove-Item -LiteralPath $p -Force
        $json = [Text.Encoding]::UTF8.GetBytes("{""success"":true,""filePath"":""" + $p.Replace('\','\\') + """}")
        $res.StatusCode = 200
        $res.ContentType = 'application/json'
        $res.OutputStream.Write($json,0,$json.Length)
        $res.Close()
        continue
      }

      if ($req.HttpMethod -eq 'POST' -and $route -eq '/upload') {
        $ms = New-Object IO.MemoryStream
        $req.InputStream.CopyTo($ms)
        $body = $ms.ToArray()
        $parts = Parse-Multipart $body $req.ContentType

        $destPath = $null
        $numeroVisita = $null
        $fileName = $null
        [byte[]]$fileBytes = @()

        foreach ($part in $parts) {
          $h = $part.Headers
          $name = [regex]::Match($h, 'name="([^"]+)"').Groups[1].Value
          $fn = [regex]::Match($h, 'filename="([^"]*)"').Groups[1].Value

          if ($fn) {
            $fileName = [IO.Path]::GetFileName($fn)
            $fileBytes = $part.Data
            continue
          }

          $txt = [Text.Encoding]::UTF8.GetString($part.Data)
          if ($name -eq 'path' -and $txt) { $destPath = Normalize-Path $txt }
          if ($name -eq 'numeroVisita' -and $txt) { $numeroVisita = $txt.Trim() }
        }

        if (-not $fileName -or $fileBytes.Length -eq 0) { $res.StatusCode = 400; $res.Close(); continue }
        if (-not $destPath) {
          if ($numeroVisita) { $destPath = Join-Path (Join-Path $RootDir $numeroVisita) $fileName }
          else { $destPath = Join-Path $RootDir $fileName }
        }

        Ensure-Parent $destPath
        [IO.File]::WriteAllBytes($destPath, $fileBytes)

        $json = [Text.Encoding]::UTF8.GetBytes("{""success"":true,""filePath"":""" + $destPath.Replace('\','\\') + """}")
        $res.StatusCode = 201
        $res.ContentType = 'application/json'
        $res.OutputStream.Write($json,0,$json.Length)
        $res.Close()
        continue
      }

      $res.StatusCode = 404
      $res.Close()
    } catch {
      $msg = $_.Exception.Message.Replace('"','\"')
      $json = [Text.Encoding]::UTF8.GetBytes("{""success"":false,""error"":""" + $msg + """}")
      $res.StatusCode = 500
      $res.ContentType = 'application/json'
      $res.OutputStream.Write($json,0,$json.Length)
      $res.Close()
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
