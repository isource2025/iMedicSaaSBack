<#
  iMedic PACS — SOLO el bridge (SIN cloudflared).
  Para Server viejo que no puede bajar ni copiar cloudflared.exe.

  El túnel lo pone la PC de adjuntos de Sarmiento (ya tiene cloudflared):
    pacs-sarmiento.imedic.com.ar → http://IP_DE_ESTE_SERVER:9013

  PowerShell Admin en el tomógrafo:

      powershell -ExecutionPolicy Bypass -File .\Instalar-Solo-Bridge-Pacs.ps1
#>

$SqlServer   = 'localhost\SQLCC'
$SqlDatabase = 'ImageServer'
$FsRoot      = 'D:\FS'
$Port        = 9013
$InstallDir  = 'C:\ProgramData\iMedic\pacs'
$BridgePs1   = Join-Path $InstallDir 'pacs-bridge.ps1'
$TaskBridge  = 'iMedic PACS Bridge'

$ErrorActionPreference = 'Stop'
Set-StrictMode -Off

function Write-Paso { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    !   $m" -ForegroundColor Yellow }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
	throw 'Ejecutar como Administrador.'
}

# Escucha en TODAS las interfaces para que la PC de adjuntos llegue por LAN
$ListenPrefix = "http://+:$Port/"

$BridgeSource = @'
param(
	[string]$SqlServer = '__SQL_SERVER__',
	[string]$SqlDatabase = '__SQL_DB__',
	[string]$FsRoot = '__FS_ROOT__',
	[int]$Port = 9013
)
$ErrorActionPreference = 'Continue'
# + = todas las IPs (LAN). Requiere URL ACL (lo hace el instalador).
$prefix = "http://+:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "[iMedic PACS] $prefix sql=$SqlServer/$SqlDatabase fs=$FsRoot"

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
		if ($params) { foreach ($k in $params.Keys) { [void]$cmd.Parameters.AddWithValue($k, $params[$k]) } }
		$da = New-Object Data.SqlClient.SqlDataAdapter $cmd
		$dt = New-Object Data.DataTable
		[void]$da.Fill($dt)
		return ,$dt
	} finally { $c.Close() }
}
function Norm-Pid([string]$p) { return (($p + '') -replace '[.\s-]', '') }
function Study-Dir($row) {
	return [IO.Path]::Combine([string]$row.FilesystemPath,[string]$row.PartitionFolder,[string]$row.StudyFolder,[string]$row.StudyInstanceUid)
}
function Safe-Under([string]$root, [string]$abs) {
	$r = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
	$a = [IO.Path]::GetFullPath($abs)
	if (-not $a.ToLowerInvariant().StartsWith($r.ToLowerInvariant()) -and $a.ToLowerInvariant() -ne $r.TrimEnd('\').ToLowerInvariant()) { return $null }
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
			$ctx.Response.StatusCode = 204; $ctx.Response.Close(); continue
		}
		if ($path -eq '/health') {
			$fsOk = Test-Path $FsRoot; $sql = 'fail'; $err = $null
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
			$r = $dt.Rows[0]; $dir = Study-Dir $r
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

Write-Host ''
Write-Host '  iMedic PACS — SOLO bridge (sin cloudflared)' -ForegroundColor White

Write-Paso 'Probar SQL'
$cs = "Server=$SqlServer;Database=$SqlDatabase;Integrated Security=SSPI;Connect Timeout=15;"
$c = New-Object Data.SqlClient.SqlConnection $cs
$c.Open(); $c.Close()
Write-Ok 'SQL OK'

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$src = $BridgeSource.Replace('__SQL_SERVER__', $SqlServer).Replace('__SQL_DB__', $SqlDatabase).Replace('__FS_ROOT__', $FsRoot)
Set-Content -Path $BridgePs1 -Value $src -Encoding UTF8
Write-Ok $BridgePs1

Write-Paso 'Permiso HTTP (urlacl) + firewall'
netsh http delete urlacl url=$ListenPrefix 2>$null | Out-Null
netsh http add urlacl url=$ListenPrefix user="Everyone"
netsh advfirewall firewall delete rule name="iMedic PACS 9013" 2>$null | Out-Null
netsh advfirewall firewall add rule name="iMedic PACS 9013" dir=in action=allow protocol=TCP localport=$Port
Write-Ok "escucha en puerto $Port (LAN)"

Write-Paso 'Tarea al logon'
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$bridgeCmd = Join-Path $InstallDir 'start-bridge.cmd'
Set-Content -Path $bridgeCmd -Value ("@echo off`r`n`"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"$BridgePs1`"") -Encoding ASCII
$runAs = $env:USERDOMAIN + '\' + $env:USERNAME
cmd /c "schtasks /Delete /TN `"$TaskBridge`" /F" 2>$null | Out-Null
cmd /c "schtasks /Create /TN `"$TaskBridge`" /TR `"$bridgeCmd`" /SC ONLOGON /RU `"$runAs`" /RL HIGHEST /IT /F"
if ($LASTEXITCODE -ne 0) {
	cmd /c "schtasks /Create /TN `"$TaskBridge`" /TR `"$bridgeCmd`" /SC ONSTART /RU SYSTEM /RL HIGHEST /F"
}
cmd /c "schtasks /Run /TN `"$TaskBridge`""
Write-Ok $TaskBridge

# IP LAN para el tecnico
$ip = $null
try {
	$ip = (Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -and $_.IPAddress } | ForEach-Object { $_.IPAddress } | Where-Object { $_ -match '^192\.' } | Select-Object -First 1)
} catch {}
if (-not $ip) { $ip = '192.168.1.83' }

Write-Paso 'Health'
Start-Sleep -Seconds 3
$ok = $false
try {
	$wc = New-Object Net.WebClient
	$txt = $wc.DownloadString("http://127.0.0.1:$Port/health")
	$wc.Dispose()
	if ($txt -match 'ok') { $ok = $true; Write-Ok $txt }
} catch { Write-Warn $_.Exception.Message }

Write-Host ''
Write-Host '  BRIDGE LISTO (sin tunel en esta PC)' -ForegroundColor Green
Write-Host ("  Local:  http://127.0.0.1:" + $Port + "/health")
Write-Host ("  LAN:    http://" + $ip + ":" + $Port + "/health") -ForegroundColor Cyan
Write-Host ''
Write-Host '  SIGUIENTE: en Cloudflare Dashboard (navegador, desde tu PC):' -ForegroundColor Yellow
Write-Host '  Zero Trust → Networks → Tunnels → imedic-sarmiento (adjuntos)'
Write-Host '  → Public Hostname → Add:'
Write-Host '      Subdomain: pacs-sarmiento'
Write-Host '      Domain:    imedic.com.ar'
Write-Host ("      Service:   http://" + $ip + ":" + $Port)
Write-Host ''
Write-Host '  La PC de adjuntos debe poder hacer ping a esa IP.'
Write-Host ''
