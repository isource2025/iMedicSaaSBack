<#
  Diagnóstico de login/sesión contra un despliegue (ej. Del Parque).

  Uso:
    .\diag_auth_dominio.ps1 -BaseUrl https://imedic.cmdelparque.com.ar/api -Usuario jperez
    .\diag_auth_dominio.ps1 -BaseUrl http://IP-SERVIDOR:5006/api -Usuario jperez   # directo al backend, sin proxy
    Opcionales: -IdEmpresa 3 -IdSector UTI -EsperarSegundos 40

  Qué muestra:
    1. Set-Cookie del login (flags Secure / SameSite / Path / Domain).
    2. /auth/me usando SOLO cookies (como el navegador).
    3. /auth/me usando SOLO Bearer (descarta problema de cookies/proxy).
    4. /auth/me otra vez tras esperar > 30 s (la sesión se relee de MySQL: detecta desfase horario).
#>
param(
	[string]$BaseUrl = 'https://imedic.cmdelparque.com.ar/api',
	[Parameter(Mandatory = $true)][string]$Usuario,
	[string]$IdEmpresa = '',
	[string]$IdSector = '',
	[int]$EsperarSegundos = 40
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$sec = Read-Host -AsSecureString "Password de $Usuario"
$Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

$tmp = Join-Path $env:TEMP ("imedic_diag_" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$jar = Join-Path $tmp 'cookies.txt'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Curl {
	param([string]$Metodo, [string]$Url, [hashtable]$Body, [string]$Bearer, [switch]$ConCookies, [switch]$GuardarCookies)
	$hdr = Join-Path $tmp 'h.txt'
	$out = Join-Path $tmp 'b.txt'
	Remove-Item $hdr, $out -ErrorAction SilentlyContinue
	$cargs = @('-s', '-k', '-X', $Metodo, $Url, '-D', $hdr, '-o', $out, '-w', '%{http_code}',
		'-H', 'Accept: application/json', '-H', ('Origin: ' + ([Uri]$Url).GetLeftPart('Authority')))
	if ($Body) {
		$bf = Join-Path $tmp 'req.json'
		[IO.File]::WriteAllText($bf, ($Body | ConvertTo-Json -Compress), $utf8)
		$cargs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bf")
	}
	if ($Bearer) { $cargs += @('-H', "Authorization: Bearer $Bearer") }
	if ($ConCookies) { $cargs += @('-b', $jar) }
	if ($GuardarCookies) { $cargs += @('-c', $jar) }
	$code = & curl.exe @cargs
	[pscustomobject]@{
		Status  = $code
		Headers = if (Test-Path $hdr) { Get-Content $hdr } else { @() }
		Body    = if (Test-Path $out) { [IO.File]::ReadAllText($out, $utf8) } else { '' }
	}
}

function Show-Me([string]$Titulo, $r) {
	Write-Host "`n=== $Titulo ===" -ForegroundColor Cyan
	$color = if ($r.Status -eq '200') { 'Green' } else { 'Red' }
	Write-Host "HTTP $($r.Status)" -ForegroundColor $color
	$b = $r.Body
	if ($b.Length -gt 400) { $b = $b.Substring(0, 400) + '...' }
	Write-Host $b
}

Write-Host "BaseUrl: $BaseUrl" -ForegroundColor Yellow

# --- 1. Login ---
$body = @{ username = $Usuario; password = $Password }
$r = Invoke-Curl -Metodo POST -Url "$BaseUrl/auth/login" -Body $body -GuardarCookies
$json = $null
try { $json = $r.Body | ConvertFrom-Json } catch {}

if ($json -and $json.step -and $json.tempToken) {
	Write-Host "Login pide paso '$($json.step)'." -ForegroundColor Yellow
	if ($json.empresas) { $json.empresas | Format-Table | Out-String | Write-Host }
	if ($json.sectores) { $json.sectores | Format-Table | Out-String | Write-Host }
	$emp = if ($IdEmpresa) { $IdEmpresa } elseif ($json.idEmpresa) { "$($json.idEmpresa)" } else { Read-Host 'IdEmpresa' }
	$body.idEmpresa = $emp
	$body.tempToken = $json.tempToken
	if ($json.step -eq 'SELECT_SECTOR' -or $IdSector) {
		$body.idSector = if ($IdSector) { $IdSector } else { Read-Host 'IdSector' }
	}
	$r = Invoke-Curl -Metodo POST -Url "$BaseUrl/auth/login" -Body $body -GuardarCookies
	try { $json = $r.Body | ConvertFrom-Json } catch { $json = $null }
	if ($json -and $json.step -eq 'SELECT_SECTOR' -and -not $body.idSector) {
		$body.idSector = Read-Host 'IdSector'
		$body.tempToken = $json.tempToken
		$r = Invoke-Curl -Metodo POST -Url "$BaseUrl/auth/login" -Body $body -GuardarCookies
		try { $json = $r.Body | ConvertFrom-Json } catch { $json = $null }
	}
}

Write-Host "`n=== LOGIN ===" -ForegroundColor Cyan
Write-Host "HTTP $($r.Status)"
$setCookies = $r.Headers | Where-Object { $_ -match '^(?i)set-cookie:' }
if ($setCookies) {
	$setCookies | ForEach-Object { Write-Host "  $_" }
} else {
	Write-Host '  (sin Set-Cookie: el backend tiene AuthCentral deshabilitado o el proxy lo descarta)' -ForegroundColor Red
}
$r.Headers | Where-Object { $_ -match '^(?i)(server|via|x-powered-by|strict-transport-security):' } | ForEach-Object { Write-Host "  $_" }

if ($r.Status -ne '200' -or -not $json -or -not $json.success) {
	Write-Host $r.Body -ForegroundColor Red
	Write-Host "`nLogin falló; no se sigue." -ForegroundColor Red
	exit 1
}

$token = $json.token
if ($setCookies -and ([Uri]$BaseUrl).Scheme -eq 'http' -and ($setCookies -match '(?i);\s*secure')) {
	Write-Host "`nATENCION: cookie Secure servida por HTTP. Un navegador en http:// la descarta." -ForegroundColor Red
}

# --- 2. /me solo cookies ---
Show-Me '/auth/me con COOKIES (como el navegador)' (Invoke-Curl -Metodo GET -Url "$BaseUrl/auth/me" -ConCookies)

# --- 3. /me solo Bearer ---
if ($token) {
	Show-Me '/auth/me con BEARER (sin cookies)' (Invoke-Curl -Metodo GET -Url "$BaseUrl/auth/me" -Bearer $token)
} else {
	Write-Host "`n(login no devolvió token en el body; se omite prueba Bearer)" -ForegroundColor Yellow
}

# --- 4. /me tras esperar ---
if ($EsperarSegundos -gt 0) {
	Write-Host "`nEsperando $EsperarSegundos s para forzar relectura de la sesión desde MySQL..." -ForegroundColor Yellow
	Start-Sleep -Seconds $EsperarSegundos
	Show-Me "/auth/me con COOKIES tras $EsperarSegundos s" (Invoke-Curl -Metodo GET -Url "$BaseUrl/auth/me" -ConCookies)
	if ($token) { Show-Me "/auth/me con BEARER tras $EsperarSegundos s" (Invoke-Curl -Metodo GET -Url "$BaseUrl/auth/me" -Bearer $token) }
}

Write-Host @"

--- Cómo leer el resultado ---
'No autorizado'                   -> la cookie no llegó al backend (Secure en http, proxy que filtra Cookie/Set-Cookie).
'Token inválido o expirado'       -> JWT_SECRET distinto entre instancias / procesos.
'Sesión expirada por inactividad' -> AuthSessions.LastActivityAt desfasado (zona horaria Node vs MySQL).
'Sesión expirada'                 -> sesión revocada o inexistente en AuthSessions (otra BD de auth?).
Cookies OK al inicio y 401 tras esperar -> casi seguro desfase horario: correr diag_sesion_servidor.js.
"@

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
