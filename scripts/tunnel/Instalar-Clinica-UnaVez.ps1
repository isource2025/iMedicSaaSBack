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

  Seguridad del file server:
    - exige token firmado de vida corta (header x-imedic-sig) con la clave de
      C:\ProgramData\iMedic\fs-sign-key.txt; sin clave solo responde /health
    - solo lee/escribe dentro de UncRoot, LocalRoot y ExtraRoots
    - sin CORS: lo llama solo el backend, nunca el navegador

  Para actualizar solo el file server en una clinica que ya tiene tunel:
  $SoloFileServer = $true (no toca cloudflared ni Super Admin).
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
# Seguridad:
$SigningKey  = ''      # clave de firma (>= 32). Vacio = conserva fs-sign-key.txt o genera una.
                       # Con IMEDIC_SIGNING_MASTER en Railway: node scripts/tunnel/clave-firma.js --servicio fs --empresa <id>
$LegacyToken = ''      # opcional: FILE_SERVER_TOKEN de Railway, solo durante la transicion
$ExtraRoots  = ''      # otras carpetas permitidas, separadas por ;
$SoloFileServer = $false  # $true = solo reinstala el file server (no toca cloudflared ni Super Admin)
# =============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Off

$Clinica = $Clinica.Trim().ToLowerInvariant()
if ($Clinica -notmatch '^[a-z0-9][a-z0-9-]*$') { throw "Clinica invalida: $Clinica" }
if (-not $UncRoot) { throw 'Falta UncRoot en CONFIG' }
if (-not $LocalRoot) { throw 'Falta LocalRoot en CONFIG' }
if (-not $SoloFileServer -and (-not $TunnelToken -or $TunnelToken -like 'PEGAR_*')) {
	throw 'Falta TunnelToken en CONFIG (generarlo con cf-setup.js)'
}

$Hostname   = "files-$Clinica.$Dominio"
$TaskName   = 'iMedic File Server'
$InstallDir = 'C:\ProgramData\iMedic'
$FsScript   = Join-Path $InstallDir 'file-server.ps1'
$SignKeyFile = Join-Path $InstallDir 'fs-sign-key.txt'
$LegacyFile  = Join-Path $InstallDir 'fs-legacy-token.txt'
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
	[string]$ExtraRoots = '__EXTRA_ROOTS__',
	[string]$SignKeyFile = '__SIGN_KEY_FILE__',
	[string]$LegacyFile = '__LEGACY_FILE__',
	[string]$EmpresaId = '__EMPRESA_ID__',
	[int]$Port = 9012,
	[int]$MaxMb = 100,
	[int]$SkewS = 300,
	[int]$MaxTtlS = 900
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LocalRoot -ErrorAction SilentlyContinue | Out-Null
$MaxBytes = $MaxMb * 1MB
$SignKey = ''
if ($SignKeyFile -and (Test-Path -LiteralPath $SignKeyFile)) { $SignKey = ([IO.File]::ReadAllText($SignKeyFile)).Trim() }
$LegacyToken = ''
if ($LegacyFile -and (Test-Path -LiteralPath $LegacyFile)) { $LegacyToken = ([IO.File]::ReadAllText($LegacyFile)).Trim() }
$Roots = @($UncRoot, $LocalRoot) + @(($ExtraRoots + '').Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
$modo = @(); if ($SignKey.Length -ge 32) { $modo += 'firma' }; if ($LegacyToken.Length -ge 16) { $modo += 'token-legado' }
Write-Host "[iMedic FS] $prefix unc=$UncRoot local=$LocalRoot auth=$(if ($modo) { $modo -join '+' } else { 'SIN CONFIGURAR' })"

function Send-Json($ctx, $code, $obj) {
	$json = ($obj | ConvertTo-Json -Compress -Depth 6)
	$bytes = [Text.Encoding]::UTF8.GetBytes($json)
	$ctx.Response.StatusCode = $code
	$ctx.Response.ContentType = 'application/json; charset=utf-8'
	$ctx.Response.ContentLength64 = $bytes.Length
	$ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
	$ctx.Response.Close()
}

function Test-Inside([string]$p) {
	if (-not $p -or $p.Contains([string][char]0)) { return $false }
	try { $full = [IO.Path]::GetFullPath($p) } catch { return $false }
	foreach ($root in $Roots) {
		if (-not $root) { continue }
		try { $r = [IO.Path]::GetFullPath($root).TrimEnd('\') } catch { continue }
		if ($full.Equals($r, [StringComparison]::OrdinalIgnoreCase)) { return $true }
		if ($full.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
	}
	return $false
}

function Test-Leaf([string]$p) {
	return (Test-Inside $p) -and (Test-Path -LiteralPath $p -PathType Leaf)
}

# Token firmado v1: mismo mensaje que src/utils/signedFileToken.js del backend.
function Unescape-Q([string]$s) { return [Uri]::UnescapeDataString($s.Replace('+', ' ')) }
function Get-RawParts([string]$raw) {
	if ($raw -match '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*(.*)$') { $raw = $Matches[1] }
	$h = $raw.IndexOf('#'); if ($h -ge 0) { $raw = $raw.Substring(0, $h) }
	$qi = $raw.IndexOf('?')
	if ($qi -ge 0) { return @($raw.Substring(0, $qi), $raw.Substring($qi + 1)) }
	return @($raw, '')
}
function Get-CanonQuery([string]$q) {
	$items = New-Object System.Collections.ArrayList
	foreach ($part in $q.Split('&')) {
		if (-not $part) { continue }
		$eq = $part.IndexOf('=')
		if ($eq -ge 0) { $k = Unescape-Q $part.Substring(0, $eq); $v = Unescape-Q $part.Substring($eq + 1) }
		else { $k = Unescape-Q $part; $v = '' }
		if ($k -ceq 'sig') { continue }
		[void]$items.Add($k + [char]0 + $v)
	}
	$arr = [string[]]$items.ToArray([string])
	[Array]::Sort($arr, [StringComparer]::Ordinal)
	$out = New-Object System.Collections.ArrayList
	foreach ($s in $arr) { $z = $s.IndexOf([char]0); [void]$out.Add($s.Substring(0, $z) + '=' + $s.Substring($z + 1)) }
	return [string]::Join('&', [string[]]$out.ToArray([string]))
}
function Get-Sig([string]$key, [string]$msg) {
	$hm = New-Object System.Security.Cryptography.HMACSHA256
	$hm.Key = [Text.Encoding]::UTF8.GetBytes($key)
	$b = $hm.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg))
	return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function Test-SameString([string]$a, [string]$b) {
	if (-not $a -or $a.Length -ne $b.Length) { return $false }
	$diff = 0
	for ($i = 0; $i -lt $a.Length; $i++) { $diff = $diff -bor ([int]$a[$i] -bxor [int]$b[$i]) }
	return ($diff -eq 0)
}
function Test-Signed($req) {
	if ($SignKey.Length -lt 32) { return $false }
	$parts = Get-RawParts ([string]$req.RawUrl)
	$tok = [string]$req.Headers['x-imedic-sig']
	if (-not $tok) {
		foreach ($p in $parts[1].Split('&')) { if ($p.StartsWith('sig=')) { $tok = Unescape-Q $p.Substring(4) } }
	}
	if (-not $tok) { return $false }
	$t = $tok.Trim().Split('.')
	if ($t.Length -ne 4 -or $t[0] -cne 'v1') { return $false }
	if ($t[1] -notmatch '^\d+$' -or $t[2] -notmatch '^\d+$') { return $false }
	if ($EmpresaId -and $EmpresaId -match '^\d+$' -and $t[1] -ne $EmpresaId) { return $false }
	$exp = [long]$t[2]
	$epoch = New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)
	$now = [long][Math]::Floor(([DateTime]::UtcNow - $epoch).TotalSeconds)
	if ($now -gt ($exp + $SkewS)) { return $false }
	if ($exp -gt ($now + $MaxTtlS + $SkewS)) { return $false }
	$ruta = $parts[0]
	try { $ruta = [Uri]::UnescapeDataString($ruta) } catch {}
	$ruta = $ruta.TrimEnd('/'); if (-not $ruta) { $ruta = '/' }
	$msg = [string]::Join("`n", [string[]]@('v1', $t[1], $req.HttpMethod.ToUpperInvariant(), $ruta, (Get-CanonQuery $parts[1]), $t[2]))
	return (Test-SameString $t[3] (Get-Sig $SignKey $msg))
}
function Test-Auth($req) {
	if (Test-Signed $req) { return $true }
	if ($LegacyToken.Length -ge 16) {
		$enviado = ([string]$req.Headers['x-imedic-token']).Trim()
		return (Test-SameString $enviado $LegacyToken)
	}
	return $false
}

function Decode-Path([string]$p) {
	if (-not $p) { return $p }
	try { $p = [Uri]::UnescapeDataString($p) } catch {}
	try {
		if ($p -match '%[0-9A-Fa-f]{2}') { $p = [Uri]::UnescapeDataString($p) }
	} catch {}
	$p = $p -replace '/', '\'
	$enie = [string][char]0x00D1
	$enieMin = [string][char]0x00F1
	$aTilde = [string][char]0x00C3
	$p = $p.Replace(($aTilde + [char]0x0091), $enie)
	$p = $p.Replace(($aTilde + [char]0x00B1), $enieMin)
	$p = $p.Replace(($aTilde + '?'), $enie)
	$p = $p.Replace(($aTilde + [char]0x2018), $enie)
	$p = $p.Replace(($aTilde + [char]0x2019), $enie)
	while ($p -match '^\\\\\\+') { $p = $p -replace '^\\\\', '\' }
	$localDrive = [IO.Path]::GetPathRoot($LocalRoot)
	if ($localDrive -and $p -match '^[A-Za-z]:\\' -and -not $p.StartsWith($localDrive, [StringComparison]::OrdinalIgnoreCase)) {
		$p = $localDrive + $p.Substring(3)
	}
	return $p
}

function Get-RawQueryPath($req) {
	$raw = $null
	try { $raw = [string]$req.RawUrl } catch { $raw = $null }
	if ($raw -and $raw.Contains('?')) {
		$q = $raw.Substring($raw.IndexOf('?') + 1)
		foreach ($pair in $q.Split('&')) {
			if ($pair.Length -ge 5 -and $pair.Substring(0, 5).ToLowerInvariant() -eq 'path=') {
				return $pair.Substring(5)
			}
		}
	}
	try { return $req.QueryString['path'] } catch { return $null }
}

function Map-Path([string]$p) {
	$hit = Map-PathCandidato $p
	if ($hit -and (Test-Inside $hit)) { return $hit }
	return $null
}

function Map-PathCandidato([string]$p) {
	$p = Decode-Path $p
	if (-not $p) { return $null }
	if (Test-Leaf $p) { return $p }

	# Relativa al UncRoot/LocalRoot de ESTA clínica (sin IP ni host fijo).
	$esAbsoluta = ($p -match '^[A-Za-z]:\\') -or ($p -like '\\*')
	if (-not $esAbsoluta) {
		foreach ($root in $Roots) {
			if (-not $root) { continue }
			$c = Join-Path $root.TrimEnd('\') $p.TrimStart('\')
			if (Test-Leaf $c) { return $c }
		}
	}

	# UNC legacy Clarion (\\192.168…\Imagenes\<share>\…): solo el sufijo relativo.
	if ($p -match '(?i)^\\\\[^\\]+\\Imagenes\\[^\\]+\\(.+)$') {
		$rel = $Matches[1]
		foreach ($root in $Roots) {
			if (-not $root) { continue }
			$c = Join-Path $root.TrimEnd('\') $rel
			if (Test-Leaf $c) { return $c }
		}
	}

	$uncNorm = $UncRoot.TrimEnd('\')
	if ($p.StartsWith($uncNorm, [StringComparison]::OrdinalIgnoreCase)) {
		$rel = $p.Substring($uncNorm.Length).TrimStart('\')
		$local = Join-Path $LocalRoot $rel
		if (Test-Leaf $local) { return $local }
	}
	$name = Split-Path $p -Leaf
	$c1 = Join-Path $LocalRoot $name
	if (Test-Leaf $c1) { return $c1 }
	$enie = [string][char]0x00D1
	$enieMin = [string][char]0x00F1
	$under = $p.Replace($enie, '_').Replace($enieMin, '_')
	if ($under -ne $p -and (Test-Leaf $under)) { return $under }
	$parentName = ''
	try { $parentName = Split-Path (Split-Path $p -Parent) -Leaf } catch { $parentName = '' }
	$visita = $null
	if ($parentName -match '^(\d+)(\s|$)') { $visita = $Matches[1] }
	if ($visita) {
		foreach ($root in $Roots) {
			if (-not $root) { continue }
			if (-not (Test-Path -LiteralPath $root)) { continue }
			foreach ($pat in @($visita, ($visita + ' *'))) {
				$enum = $null
				try { $enum = [IO.Directory]::EnumerateDirectories($root, $pat) } catch { continue }
				foreach ($full in $enum) {
					$leaf = [IO.Path]::GetFileName($full)
					if ($leaf -ne $visita -and -not $leaf.StartsWith($visita + ' ')) { continue }
					$c = Join-Path $full $name
					if (Test-Leaf $c) { return $c }
				}
			}
		}
	}
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
		$rawUrl = [string]$req.RawUrl
		$abs = $rawUrl
		$qi = $abs.IndexOf('?')
		if ($qi -ge 0) { $abs = $abs.Substring(0, $qi) }
		$path = $abs.TrimEnd('/')
		if (-not $path) { $path = '/' }

		$authed = Test-Auth $req

		if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/health')) {
			$epochH = New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)
			$h = @{
				success=$true; ok=$true; status='ok'; encoding='ps1-unc-v3'; security='v1'
				clinica='__CLINICA__'; maxMb=$MaxMb; auth=$(if ($modo) { $modo -join '+' } else { 'sin-configurar' })
				epoch = [long][Math]::Floor(([DateTime]::UtcNow - $epochH).TotalSeconds)
				uncReachable = [bool](Test-Path -LiteralPath $UncRoot)
			}
			if ($authed) { $h.unc = $UncRoot; $h.root = $LocalRoot; $h.extraRoots = $ExtraRoots; $h.port = $Port }
			Send-Json $ctx 200 $h
			continue
		}

		if (-not $modo) {
			Send-Json $ctx 503 @{ success=$false; error="File server sin credenciales: falta $SignKeyFile (reinstalar con Instalar-Clinica-UnaVez.ps1)" }
			continue
		}
		if (-not $authed) {
			Write-Host "[iMedic FS] 401 $method $path"
			Send-Json $ctx 401 @{ success=$false; error='Token inválido' }
			continue
		}

		if ($method -eq 'GET' -and $path -eq '/file') {
			$pedida = Get-RawQueryPath $req
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
			$fn = [Uri]::EscapeDataString([IO.Path]::GetFileName($found))
			$ctx.Response.AddHeader('Content-Disposition', "inline; filename*=UTF-8''$fn")
			$ctx.Response.ContentLength64 = $bytes.Length
			$ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
			$ctx.Response.Close()
			continue
		}

		if ($method -eq 'DELETE' -and $path -eq '/file') {
			$found = Map-Path (Get-RawQueryPath $req)
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
			# Ruta relativa (requisitos): anteponer UncRoot de esta clínica.
			if ($dest -and ($dest -notmatch '^[A-Za-z]:\\') -and ($dest -notlike '\\*')) {
				$baseRoot = if (Test-Path -LiteralPath $UncRoot) { $UncRoot } else { $LocalRoot }
				$dest = Join-Path $baseRoot.TrimEnd('\') $dest.TrimStart('\')
			}
			if (-not (Test-Inside $dest)) {
				Write-Host "[iMedic FS] upload rechazado, destino fuera de las carpetas permitidas: $dest"
				Send-Json $ctx 400 @{ success=$false; error='Destino fuera de la carpeta de adjuntos de la clinica' }; continue
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
	Replace('__EXTRA_ROOTS__', $ExtraRoots.Replace("'", "''")).
	Replace('__SIGN_KEY_FILE__', $SignKeyFile.Replace("'", "''")).
	Replace('__LEGACY_FILE__', $LegacyFile.Replace("'", "''")).
	Replace('__EMPRESA_ID__', [string]$EmpresaId).
	Replace('__CLINICA__', $Clinica)

function Protect-KeyFile([string]$f) {
	# Solo Administradores y SYSTEM (por SID) + el usuario que corre la tarea (UNC).
	cmd /c "icacls `"$f`" /inheritance:r /grant:r *S-1-5-32-544:F *S-1-5-18:F `"$User`":R" 2>$null | Out-Null
	if ($LASTEXITCODE -ne 0) { Write-Warn "no se pudieron restringir permisos de $f" }
}

function Install-Keys {
	New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
	$key = $SigningKey
	if (-not $key -and (Test-Path -LiteralPath $SignKeyFile)) { $key = ([IO.File]::ReadAllText($SignKeyFile)).Trim() }
	if ($key -and $key.Length -lt 32) { throw 'SigningKey tiene que tener al menos 32 caracteres.' }
	if (-not $key) {
		$buf = New-Object byte[] 32
		(New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($buf)
		$key = ([BitConverter]::ToString($buf)).Replace('-', '').ToLowerInvariant()
		Write-Ok "clave de firma nueva en $SignKeyFile"
	} else {
		Write-Ok "clave de firma en $SignKeyFile"
	}
	[IO.File]::WriteAllText($SignKeyFile, $key)
	Protect-KeyFile $SignKeyFile
	if ($LegacyToken) {
		[IO.File]::WriteAllText($LegacyFile, $LegacyToken.Trim())
		Protect-KeyFile $LegacyFile
		Write-Ok "token legado en $LegacyFile (borrarlo cuando Railway ya firme)"
	} elseif (Test-Path -LiteralPath $LegacyFile) {
		Write-Warn "queda token legado en $LegacyFile (borrarlo cuando Railway ya firme)"
	}
	return $key
}

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
	$trigLoop = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
	$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew `
		-RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

	# Disco local → SYSTEM al boot, sin iniciar sesion.
	# Share UNC → usuario interactivo (SYSTEM no ve la red).
	$usaRed = $UncRoot -like '\\*'
	if ($usaRed) {
		$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
		$trigs = @(
			(New-ScheduledTaskTrigger -AtLogOn -User $User),
			(New-ScheduledTaskTrigger -AtStartup),
			$trigLoop
		)
		$quien = $User
	} else {
		$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
		$trigs = @(
			(New-ScheduledTaskTrigger -AtStartup),
			$trigLoop
		)
		$quien = 'SYSTEM (sin sesion)'
	}

	Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigs `
		-Principal $principal -Settings $settings -Force `
		-Description "File server adjuntos $Clinica ($UncRoot)" | Out-Null
	Start-ScheduledTask -TaskName $TaskName
	Write-Ok "tarea '$TaskName' como $quien"
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

if (-not $SoloFileServer) {
	Write-Paso 'cloudflared'
	$Cloudflared = Install-Cloudflared
}

Write-Paso 'Claves del file server'
$ClaveFirma = Install-Keys

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
	if ($enc -ne 'ps1-unc-v3') {
		Write-Warn "health encoding=$enc (esperado ps1-unc-v3); matando puerto y reintento..."
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

if (-not $SoloFileServer) {
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
}

Write-Host ''
Write-Host '  LISTO' -ForegroundColor Green
Write-Host "  https://$Hostname" -ForegroundColor Cyan
Write-Host "  Local health: http://127.0.0.1:$Port/health"
Write-Host ''
Write-Host '  Clave de firma de esta clinica (Railway, FILE_SERVER_SIGNING_KEYS):' -ForegroundColor Yellow
Write-Host ("      `"{0}`":`"{1}`"" -f $EmpresaId, $ClaveFirma) -ForegroundColor White
Write-Host "  (queda en $SignKeyFile; si Railway usa IMEDIC_SIGNING_MASTER y la clave salio de clave-firma.js, no hace falta cargarla)"
Write-Host ''
