# Recupera el PDF/JPG que el stub guardó dentro de C:\imedic\adjuntos\upload.bin
param(
	[string] $Bin = 'C:\imedic\adjuntos\upload.bin',
	[string] $OutDir = 'C:\imedic\adjuntos\recuperados'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Bin)) { throw "No está $Bin" }

$bytes = [IO.File]::ReadAllBytes((Resolve-Path $Bin))
$pdf = [byte[]](0x25, 0x50, 0x44, 0x46) # %PDF
$jpg = [byte[]](0xFF, 0xD8, 0xFF)
$png = [byte[]](0x89, 0x50, 0x4E, 0x47)

function Find-Magic([byte[]]$hay, [byte[]]$needle) {
	for ($i = 0; $i -le $hay.Length - $needle.Length; $i++) {
		$ok = $true
		for ($j = 0; $j -lt $needle.Length; $j++) {
			if ($hay[$i + $j] -ne $needle[$j]) { $ok = $false; break }
		}
		if ($ok) { return $i }
	}
	return -1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$start = Find-Magic $bytes $pdf
$ext = 'pdf'
if ($start -lt 0) { $start = Find-Magic $bytes $jpg; $ext = 'jpg' }
if ($start -lt 0) { $start = Find-Magic $bytes $png; $ext = 'png' }
if ($start -lt 0) { throw 'upload.bin no tiene un PDF/JPG/PNG adentro (es el body HTTP crudo o está vacío).' }

$out = Join-Path $OutDir ("recuperado.{0}" -f $ext)
$len = $bytes.Length - $start
$chunk = New-Object byte[] $len
[Array]::Copy($bytes, $start, $chunk, 0, $len)
[IO.File]::WriteAllBytes($out, $chunk)
Write-Host "Listo: $out  ($len bytes)"
explorer.exe $OutDir
