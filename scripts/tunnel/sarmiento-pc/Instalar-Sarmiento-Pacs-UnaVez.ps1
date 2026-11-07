<#
  iMedic — PACS Sarmiento UNA VEZ (sin repo, sin Node, sin CF_API_TOKEN).
  Compatible con PowerShell 2.0 (Windows Server viejo). No usar #Requires.

  En la PC del tomógrafo (ClearCanvas), PowerShell como Administrador:

      Set-ExecutionPolicy Bypass -Scope Process -Force
      .\Instalar-Sarmiento-Pacs-UnaVez.ps1

  Hace:
    1. cloudflared (login en navegador la 1ª vez → imedic.com.ar)
    2. túnel imedic-pacs-sarmiento + DNS pacs-sarmiento.imedic.com.ar
    3. bridge HTTP en 127.0.0.1:9013 (SQL ImageServer + D:\FS)
    4. tareas al inicio (sobrevive reinicio)
    5. opcional: graba PacsUrl en Super Admin si hay SaPass
#>

# =============================================================================
# CONFIG — lo único que editás
# =============================================================================
$Clinica      = 'sarmiento'
$EmpresaId    = 101
$SqlServer    = 'localhost\SQLCC'
$SqlDatabase  = 'ImageServer'
# Autenticación Windows (lo que usa el técnico / SSMS). No pide password.
$UseWindowsAuth = $true
$FsRoot       = 'D:\FS'
$Port         = 9013
$Dominio      = 'imedic.com.ar'
# Solo si algún día usás SQL user/password (dejar vacío con Windows auth):
$SqlUser      = ''
$SqlPassword  = ''
# Grabar PacsUrl en la nube (opcional):
$ApiBase      = 'https://imedicsaasback-production.up.railway.app/api'
$SaUser       = 'superadmin'
$SaPass       = ''              # vacío = no graba; después: set-pacs-url.js
# =============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Off

$Clinica = $Clinica.Trim().ToLowerInvariant()
$Hostname   = "pacs-$Clinica.$Dominio"
$TunnelName = "imedic-pacs-$Clinica"
$InstallDir = 'C:\ProgramData\iMedic\pacs'
$BridgePs1  = Join-Path $InstallDir 'pacs-bridge.ps1'
$EnvFile    = Join-Path $InstallDir 'pacs.env'
$CfDir      = 'C:\ProgramData\Cloudflare\cloudflared'
$TaskBridge = 'iMedic PACS Bridge'
$TaskTunnel = 'iMedic cloudflared PACS'

function Write-Paso { param([string]$m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    !   $m" -ForegroundColor Yellow }

function Assert-Admin {
	$id = [Security.Principal.WindowsIdentity]::GetCurrent()
	$pr = New-Object Security.Principal.WindowsPrincipal($id)
	if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
		throw 'Ejecutar como Administrador.'
	}
}

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

	# Copias manuales (este server viejo suele fallar al bajar de GitHub por TLS)
	$manual = @(
		(Join-Path $env:USERPROFILE 'Desktop\cloudflared.exe'),
		(Join-Path $env:USERPROFILE 'Downloads\cloudflared.exe'),
		'C:\cloudflared.exe',
		'C:\Temp\cloudflared.exe'
	)
	$dir = "$env:ProgramFiles\cloudflared"
	New-Item -ItemType Directory -Force -Path $dir | Out-Null
	$exe = Join-Path $dir 'cloudflared.exe'
	foreach ($src in $manual) {
		if (Test-Path $src) {
			Copy-Item $src $exe -Force
			Write-Ok "cloudflared copiado desde $src"
			break
		}
	}

	if (-not (Test-Path $exe)) {
		Write-Warn 'Bajando cloudflared (puede fallar en Server viejo)...'
		try {
			try { [Net.ServicePointManager]::SecurityProtocol = [Enum]::ToObject([Net.SecurityProtocolType], 3072) } catch {}
			try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
			$wc = New-Object System.Net.WebClient
			$wc.DownloadFile('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', $exe)
			$wc.Dispose()
		} catch {
			throw @"
No se pudo bajar cloudflared (TLS viejo del servidor).

En TU PC moderna baja:
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe

Copialo al Escritorio del servidor como:
  $($env:USERPROFILE)\Desktop\cloudflared.exe

Y volve a correr este script.
"@
		}
	}

	$mp = [Environment]::GetEnvironmentVariable('Path', 'Machine')
	if ($mp -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', "$mp;$dir", 'Machine') }
	$env:Path = "$env:Path;$dir"
	Write-Ok "instalado: $exe"
	return $exe
}

function New-SqlConn([string]$server, [string]$db, [string]$user, [string]$pass, [bool]$windowsAuth) {
	if ($windowsAuth) {
		$cs = "Server=$server;Database=$db;Integrated Security=SSPI;Connect Timeout=15;"
	} else {
		$cs = "Server=$server;Database=$db;User ID=$user;Password=$pass;Connect Timeout=15;"
	}
	$c = New-Object Data.SqlClient.SqlConnection $cs
	$c.Open()
	return $c
}

# -------------------- bridge HTTP embebido (sin Node) --------------------
$BridgeSource = @'
param(
	[string]$SqlServer = '__SQL_SERVER__',
	[string]$SqlDatabase = '__SQL_DB__',
	[string]$FsRoot = '__FS_ROOT__',
	[int]$Port = 9013,
	[string]$UseWindowsAuth = '__WIN_AUTH__'
)
$ErrorActionPreference = 'Continue'
$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "[iMedic PACS] $prefix sql=$SqlServer/$SqlDatabase auth=windows fs=$FsRoot"

function ConvertTo-JsonPs2($obj) {
	Add-Type -AssemblyName System.Web.Extensions -ErrorAction SilentlyContinue
	$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
	$ser.MaxJsonLength = 67108864
	return $ser.Serialize($obj)
}
function Send-Json($ctx, $code, $obj) {
	$json = ConvertTo-JsonPs2 $obj
	$bytes = [Text.Encoding]::UTF8.GetBytes($json)
	$ctx.Response.StatusCode = $code
	$ctx.Response.ContentType = 'application/json; charset=utf-8'
	$ctx.Response.Headers['Access-Control-Allow-Origin'] = '*'
	$ctx.Response.ContentLength64 = $bytes.Length
	$ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
	$ctx.Response.Close()
}

function Get-Pool {
	$cs = "Server=$SqlServer;Database=$SqlDatabase;Integrated Security=SSPI;Connect Timeout=15;"
	$c = New-Object Data.SqlClient.SqlConnection $cs
	$c.Open()
	return $c
}

function Invoke-Q([string]$sql, $params) {
	$c = Get-Pool
	try {
		$cmd = $c.CreateCommand()
		$cmd.CommandText = "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; $sql"
		$cmd.CommandTimeout = 60
		if ($params) {
			foreach ($k in $params.Keys) {
				[void]$cmd.Parameters.AddWithValue($k, $params[$k])
			}
		}
		$da = New-Object Data.SqlClient.SqlDataAdapter $cmd
		$dt = New-Object Data.DataTable
		[void]$da.Fill($dt)
		return ,$dt
	} finally { $c.Close() }
}

function Norm-Pid([string]$p) {
	return (($p + '') -replace '[.\s-]', '')
}

function Study-Dir($row) {
	return [IO.Path]::Combine(
		[string]$row.FilesystemPath,
		[string]$row.PartitionFolder,
		[string]$row.StudyFolder,
		[string]$row.StudyInstanceUid
	)
}

function Safe-Under([string]$root, [string]$abs) {
	$r = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
	$a = [IO.Path]::GetFullPath($abs)
	if (-not $a.ToLowerInvariant().StartsWith($r.ToLowerInvariant()) -and $a.ToLowerInvariant() -ne $r.TrimEnd('\').ToLowerInvariant()) {
		return $null
	}
	return $a
}

while ($listener.IsListening) {
	$ctx = $listener.GetContext()
	try {
		$req = $ctx.Request
		$path = $req.Url.AbsolutePath.TrimEnd('/')
		if ($path -eq '') { $path = '/' }

		if ($req.HttpMethod -eq 'OPTIONS') {
			$ctx.Response.Headers['Access-Control-Allow-Origin'] = '*'
			$ctx.Response.Headers['Access-Control-Allow-Methods'] = 'GET,OPTIONS'
			$ctx.Response.Headers['Access-Control-Allow-Headers'] = '*'
			$ctx.Response.StatusCode = 204
			$ctx.Response.Close()
			continue
		}

		if ($path -eq '/health') {
			$fsOk = Test-Path $FsRoot
			$sql = 'fail'; $err = $null
			try { $null = Invoke-Q 'SELECT 1 AS ok' $null; $sql = 'ok' } catch { $err = $_.Exception.Message }
			Send-Json $ctx $(if ($sql -eq 'ok') { 200 } else { 503 }) @{
				ok = ($sql -eq 'ok'); service = 'imedic-pacs-bridge-ps1'; port = $Port
				sqlServer = $SqlServer; database = $SqlDatabase; fsRoot = $FsRoot
				fsExists = $fsOk; sql = $sql; sqlError = $err
			}
			continue
		}

		if ($path -eq '/studies') {
			$pid = Norm-Pid $req.QueryString['patientId']
			if (-not $pid) { $pid = Norm-Pid $req.QueryString['PatientID'] }
			if (-not $pid) { Send-Json $ctx 400 @{ error = 'Falta patientId' }; continue }
			$dt = Invoke-Q @"
SELECT st.StudyInstanceUid AS studyInstanceUid, st.StudyDate AS studyDate, st.StudyTime AS studyTime,
  st.StudyDescription AS studyDescription, st.AccessionNumber AS accessionNumber,
  st.PatientId AS patientId, st.PatientsName AS patientsName,
  st.NumberOfStudyRelatedSeries AS seriesCount, st.NumberOfStudyRelatedInstances AS instanceCount
FROM dbo.Study st
WHERE REPLACE(REPLACE(REPLACE(ISNULL(st.PatientId,''), '.', ''), '-', ''), ' ', '') = @pid
ORDER BY st.StudyDate DESC, st.StudyTime DESC
"@ @{ '@pid' = $pid }
			$rows = @()
			foreach ($r in $dt.Rows) {
				$rows += @{
					studyInstanceUid = [string]$r.studyInstanceUid; studyDate = [string]$r.studyDate
					studyTime = [string]$r.studyTime; studyDescription = [string]$r.studyDescription
					accessionNumber = [string]$r.accessionNumber; patientId = [string]$r.patientId
					patientsName = [string]$r.patientsName; seriesCount = [int]$r.seriesCount
					instanceCount = [int]$r.instanceCount
				}
			}
			Send-Json $ctx 200 @{ patientId = $pid; count = $rows.Count; studies = $rows }
			continue
		}

		if ($path -match '^/studies/([^/]+)$') {
			$uid = [Uri]::UnescapeDataString($Matches[1])
			$dt = Invoke-Q @"
SELECT TOP 1 st.StudyInstanceUid AS StudyInstanceUid, st.StudyDate AS StudyDate,
  st.StudyDescription AS StudyDescription, st.PatientId AS PatientId, st.PatientsName AS PatientsName,
  st.NumberOfStudyRelatedSeries AS seriesCount, st.NumberOfStudyRelatedInstances AS instanceCount,
  fs.FilesystemPath, sp.PartitionFolder, fss.StudyFolder
FROM dbo.Study st
JOIN dbo.ServerPartition sp ON sp.GUID = st.ServerPartitionGUID
JOIN dbo.StudyStorage ss ON ss.ServerPartitionGUID = st.ServerPartitionGUID AND ss.StudyInstanceUid = st.StudyInstanceUid
JOIN dbo.FilesystemStudyStorage fss ON fss.StudyStorageGUID = ss.GUID
JOIN dbo.Filesystem fs ON fs.GUID = fss.FilesystemGUID
WHERE st.StudyInstanceUid = @uid
"@ @{ '@uid' = $uid }
			if ($dt.Rows.Count -eq 0) { Send-Json $ctx 404 @{ error = 'Estudio no encontrado' }; continue }
			$r = $dt.Rows[0]
			$dir = Study-Dir $r
			Send-Json $ctx 200 @{
				studyInstanceUid = [string]$r.StudyInstanceUid; studyDate = [string]$r.StudyDate
				studyDescription = [string]$r.StudyDescription; patientId = [string]$r.PatientId
				patientsName = [string]$r.PatientsName; seriesCount = [int]$r.seriesCount
				instanceCount = [int]$r.instanceCount; path = $dir; pathExists = (Test-Path $dir)
			}
			continue
		}

		if ($path -match '^/studies/([^/]+)/series$') {
			$uid = [Uri]::UnescapeDataString($Matches[1])
			$dt = Invoke-Q @"
SELECT SeriesInstanceUid AS seriesInstanceUid, SeriesNumber AS seriesNumber, Modality AS modality,
  SeriesDescription AS seriesDescription, NumberOfSeriesRelatedInstances AS instanceCount
FROM dbo.Series WHERE StudyInstanceUid = @uid ORDER BY SeriesNumber
"@ @{ '@uid' = $uid }
			$rows = @()
			foreach ($r in $dt.Rows) {
				$rows += @{
					seriesInstanceUid = [string]$r.seriesInstanceUid; seriesNumber = $r.seriesNumber
					modality = [string]$r.modality; seriesDescription = [string]$r.seriesDescription
					instanceCount = [int]$r.instanceCount
				}
			}
			Send-Json $ctx 200 @{ studyInstanceUid = $uid; count = $rows.Count; series = $rows }
			continue
		}

		if ($path -match '^/studies/([^/]+)/files$') {
			$uid = [Uri]::UnescapeDataString($Matches[1])
			$dt = Invoke-Q @"
SELECT TOP 1 fs.FilesystemPath, sp.PartitionFolder, fss.StudyFolder, st.StudyInstanceUid
FROM dbo.Study st
JOIN dbo.ServerPartition sp ON sp.GUID = st.ServerPartitionGUID
JOIN dbo.StudyStorage ss ON ss.ServerPartitionGUID = st.ServerPartitionGUID AND ss.StudyInstanceUid = st.StudyInstanceUid
JOIN dbo.FilesystemStudyStorage fss ON fss.StudyStorageGUID = ss.GUID
JOIN dbo.Filesystem fs ON fs.GUID = fss.FilesystemGUID
WHERE st.StudyInstanceUid = @uid
"@ @{ '@uid' = $uid }
			if ($dt.Rows.Count -eq 0) { Send-Json $ctx 404 @{ error = 'Estudio no encontrado' }; continue }
			$dir = Safe-Under $FsRoot (Study-Dir $dt.Rows[0])
			if (-not $dir -or -not (Test-Path $dir)) { Send-Json $ctx 404 @{ error = 'Carpeta no existe'; path = $dir }; continue }
			$files = New-Object System.Collections.ArrayList
			Get-ChildItem $dir -Recurse -Filter *.dcm -ErrorAction SilentlyContinue | ForEach-Object {
				$rel = $_.FullName.Substring($dir.Length).TrimStart('\').Replace('\', '/')
				[void]$files.Add(@{ path = $rel; size = $_.Length })
			}
			Send-Json $ctx 200 @{ studyInstanceUid = $uid; count = $files.Count; files = @($files) }
			continue
		}

		if ($path -match '^/studies/([^/]+)/file$') {
			$uid = [Uri]::UnescapeDataString($Matches[1])
			$rel = $req.QueryString['path']
			if (-not $rel -or $rel.Contains('..')) { Send-Json $ctx 400 @{ error = 'path invalido' }; continue }
			$dt = Invoke-Q @"
SELECT TOP 1 fs.FilesystemPath, sp.PartitionFolder, fss.StudyFolder, st.StudyInstanceUid
FROM dbo.Study st
JOIN dbo.ServerPartition sp ON sp.GUID = st.ServerPartitionGUID
JOIN dbo.StudyStorage ss ON ss.ServerPartitionGUID = st.ServerPartitionGUID AND ss.StudyInstanceUid = st.StudyInstanceUid
JOIN dbo.FilesystemStudyStorage fss ON fss.StudyStorageGUID = ss.GUID
JOIN dbo.Filesystem fs ON fs.GUID = fss.FilesystemGUID
WHERE st.StudyInstanceUid = @uid
"@ @{ '@uid' = $uid }
			if ($dt.Rows.Count -eq 0) { Send-Json $ctx 404 @{ error = 'Estudio no encontrado' }; continue }
			$dir = Safe-Under $FsRoot (Study-Dir $dt.Rows[0])
			$abs = Safe-Under $FsRoot ([IO.Path]::Combine($dir, ($rel -replace '/', '\')))
			if (-not $abs -or -not (Test-Path $abs)) { Send-Json $ctx 404 @{ error = 'Archivo no encontrado' }; continue }
			$bytes = [IO.File]::ReadAllBytes($abs)
			$ctx.Response.StatusCode = 200
			$ctx.Response.ContentType = 'application/dicom'
			$ctx.Response.Headers['Access-Control-Allow-Origin'] = '*'
			$ctx.Response.ContentLength64 = $bytes.Length
			$ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
			$ctx.Response.Close()
			continue
		}

		Send-Json $ctx 404 @{ error = 'not found' }
	} catch {
		try { Send-Json $ctx 500 @{ error = $_.Exception.Message } } catch {}
	}
}
'@

# =============================================================================
Assert-Admin

Write-Host ''
Write-Host '  iMedic PACS — instalacion UNA VEZ' -ForegroundColor White
Write-Host "  hostname:  https://$Hostname"
Write-Host "  bridge:    127.0.0.1:$Port"
Write-Host "  SQL:       $SqlServer / $SqlDatabase (Windows auth)"
Write-Host "  FS:        $FsRoot"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $CfDir | Out-Null

Write-Paso 'Probar SQL (Integrated Security / Windows)'
try {
	$tc = New-SqlConn $SqlServer $SqlDatabase '' '' $true
	$tc.Close()
	Write-Ok 'SQL OK con autenticacion Windows'
} catch {
	throw ("No conecta SQL con Windows auth: " + $_.Exception.Message)
}

if (-not (Test-Path $FsRoot)) { Write-Warn "No existe $FsRoot" }

Write-Paso 'Escribir bridge'
$src = $BridgeSource
$src = $src.Replace('__SQL_SERVER__', $SqlServer)
$src = $src.Replace('__SQL_DB__', $SqlDatabase)
$src = $src.Replace('__FS_ROOT__', $FsRoot)
$src = $src.Replace('__WIN_AUTH__', '1')
Set-Content -Path $BridgePs1 -Value $src -Encoding UTF8
Write-Ok $BridgePs1

@"
IMEDIC_PACS_HOSTNAME=https://$Hostname
IMEDIC_PACS_PORT=$Port
IMEDIC_PACS_SQL_SERVER=$SqlServer
IMEDIC_PACS_SQL_DATABASE=$SqlDatabase
IMEDIC_PACS_WINDOWS_AUTH=1
IMEDIC_PACS_FS_ROOT=$FsRoot
"@ | Set-Content -Path $EnvFile -Encoding ASCII

Write-Paso 'cloudflared'
$Cloudflared = Install-Cloudflared

Write-Paso 'Login Cloudflare (navegador — elegí imedic.com.ar)'
$CertUser = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
$CertProg = Join-Path $CfDir 'cert.pem'
if ((Test-Path $CertProg) -and -not (Test-Path $CertUser)) {
	New-Item -ItemType Directory -Force -Path (Split-Path $CertUser) | Out-Null
	Copy-Item $CertProg $CertUser -Force
}
if (-not (Test-Path $CertUser)) {
	& $Cloudflared tunnel login
	if (-not (Test-Path $CertUser)) { throw 'Login Cloudflare incompleto.' }
}
Copy-Item $CertUser $CertProg -Force
Write-Ok 'autenticado'

function Get-TunnelIdByName([string]$cf, [string]$name) {
	$out = & $cf tunnel list 2>$null | Out-String
	foreach ($line in ($out -split "`r?`n")) {
		if ($line -match $name) {
			if ($line -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') {
				return $Matches[1]
			}
		}
	}
	return $null
}

function Get-HttpText([string]$url) {
	$wc = New-Object System.Net.WebClient
	$wc.Encoding = [Text.Encoding]::UTF8
	try { return $wc.DownloadString($url) } finally { $wc.Dispose() }
}

Write-Paso "Tunel $TunnelName"
$TunnelId = Get-TunnelIdByName $Cloudflared $TunnelName
if ($TunnelId) {
	Write-Ok "ya existe ($TunnelId)"
} else {
	$createOut = (& $Cloudflared tunnel create $TunnelName 2>&1 | Out-String)
	Write-Host $createOut
	$TunnelId = Get-TunnelIdByName $Cloudflared $TunnelName
	if (-not $TunnelId -and $createOut -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') {
		$TunnelId = $Matches[1]
	}
	if (-not $TunnelId) { throw "No se pudo crear $TunnelName" }
	Write-Ok "creado ($TunnelId)"
}

$CredsUser = Join-Path $env:USERPROFILE (".cloudflared\" + $TunnelId + ".json")
$CredsProg = Join-Path $CfDir ($TunnelId + ".json")
if (Test-Path $CredsUser) { Copy-Item $CredsUser $CredsProg -Force }
elseif (-not (Test-Path $CredsProg)) { throw ("Faltan credenciales " + $TunnelId + ".json") }

$ConfigPath = Join-Path $CfDir 'config-pacs.yml'
$configTxt = @"
tunnel: $TunnelId
credentials-file: $CredsProg
metrics: 127.0.0.1:20242
loglevel: info
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:$Port
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
"@
Set-Content -Path $ConfigPath -Value $configTxt -Encoding ASCII
Write-Ok $ConfigPath

Write-Paso 'DNS'
& $Cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear DNS $Hostname" }
Write-Ok ("https://" + $Hostname)

Write-Paso 'Tareas programadas (schtasks — compatible Server viejo)'
# Bridge con el usuario Administrator actual (Windows auth a SQL).
# Túnel puede ir como SYSTEM.
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$bridgeCmd = Join-Path $InstallDir 'start-bridge.cmd'
$tunnelCmd = Join-Path $InstallDir 'start-tunnel.cmd'
Set-Content -Path $bridgeCmd -Value ("@echo off`r`n`"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"$BridgePs1`"") -Encoding ASCII
Set-Content -Path $tunnelCmd -Value ("@echo off`r`n`"$Cloudflared`" tunnel --config `"$ConfigPath`" run") -Encoding ASCII
$runAs = $env:USERDOMAIN + '\' + $env:USERNAME
cmd /c "schtasks /Delete /TN `"$TaskBridge`" /F" 2>$null | Out-Null
cmd /c "schtasks /Delete /TN `"$TaskTunnel`" /F" 2>$null | Out-Null
# ONLOGON: corre con el mismo usuario Windows que entra a SQL
cmd /c "schtasks /Create /TN `"$TaskBridge`" /TR `"$bridgeCmd`" /SC ONLOGON /RU `"$runAs`" /RL HIGHEST /IT /F"
if ($LASTEXITCODE -ne 0) {
	Write-Warn 'ONLOGON con usuario fallo; intento ONSTART SYSTEM'
	cmd /c "schtasks /Create /TN `"$TaskBridge`" /TR `"$bridgeCmd`" /SC ONSTART /RU SYSTEM /RL HIGHEST /F"
	if ($LASTEXITCODE -ne 0) { throw "No se pudo crear tarea $TaskBridge" }
}
cmd /c "schtasks /Create /TN `"$TaskTunnel`" /TR `"$tunnelCmd`" /SC ONSTART /RU SYSTEM /RL HIGHEST /F"
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear tarea $TaskTunnel" }
cmd /c "schtasks /Run /TN `"$TaskBridge`""
cmd /c "schtasks /Run /TN `"$TaskTunnel`""
Write-Ok "$TaskBridge + $TaskTunnel"

Write-Paso 'Health local'
$localOk = $false
for ($i = 0; $i -lt 20; $i++) {
	Start-Sleep -Seconds 2
	try {
		$txt = Get-HttpText ("http://127.0.0.1:" + $Port + "/health")
		if ($txt -match '"sql"\s*:\s*"ok"' -or $txt -match '"ok"\s*:\s*true') { $localOk = $true; break }
	} catch {}
}
if ($localOk) { Write-Ok ("http://127.0.0.1:" + $Port + "/health") }
else { Write-Warn 'bridge aun no responde; revisa schtasks iMedic PACS Bridge' }

Write-Paso 'Health publico'
$pubOk = $false
for ($i = 0; $i -lt 25; $i++) {
	Start-Sleep -Seconds 3
	try {
		$txt = Get-HttpText ("https://" + $Hostname + "/health")
		if ($txt -match '"sql"\s*:\s*"ok"' -or $txt -match '"ok"\s*:\s*true') { $pubOk = $true; break }
	} catch {}
}
if ($pubOk) { Write-Ok ("https://" + $Hostname + "/health") }
else { Write-Warn 'publico aun no responde (DNS puede tardar unos minutos)' }

Write-Warn ("Graba PacsUrl desde tu PC: node scripts/tunnel/set-pacs-url.js --empresa " + $EmpresaId + " --url https://" + $Hostname)

Write-Host ''
if ($localOk) {
	Write-Host '  LISTO — el PACS queda publicado y arranca solo al reiniciar.' -ForegroundColor Green
	Write-Host ("  https://" + $Hostname) -ForegroundColor Cyan
} else {
	Write-Host '  Instalado con avisos. Revisa schtasks.' -ForegroundColor Yellow
}
Write-Host ''
