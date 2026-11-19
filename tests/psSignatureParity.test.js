/**
 * Los servidores PowerShell de las clínicas (Instalar-Clinica-UnaVez.ps1 y el
 * bridge PACS de Sarmiento) tienen que aceptar exactamente los tokens que firma
 * el backend. Corre el Test-Signed real de cada script con pwsh; si no hay
 * pwsh (PWSH=/ruta o en el PATH), se saltea.
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { signRequest } = require('../src/utils/signedFileToken');

const PWSH = process.env.PWSH || 'pwsh';
const hayPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;

const KEY = 'c0ffee'.repeat(8);
const SCRIPTS = [
	'scripts/tunnel/Instalar-Clinica-UnaVez.ps1',
	'scripts/tunnel/sarmiento-pc/Instalar-Solo-Bridge-Pacs.ps1',
];

function funcionesDeFirma(rel) {
	const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
	const desde = src.indexOf('# Token firmado v1');
	const ts = src.indexOf('function Test-Signed', desde);
	const hasta = src.indexOf('\n}\n', ts);
	assert.ok(desde > 0 && ts > desde && hasta > ts, `no encuentro las funciones de firma en ${rel}`);
	return src.slice(desde, hasta + 3).replace(/\r\n/g, '\n');
}

const URLS = [
	['GET', '/file?path=C%253A%255Cimedic%255Cadjuntos%255C1%2520PE%25C3%2591A%255Ca%2Bb.pdf'],
	['GET', '/health'],
	['DELETE', '/file?path=E%3A%5Cadjuntos%5Cx.pdf'],
	['POST', '/upload'],
	['GET', '/studies?patientId=30123456&b=1&a=2&a=1'],
	['GET', '/studies/1.2.840.113619.2.55/file?path=FOLDER%2Fimg+1.dcm'],
];

test('Test-Signed de PowerShell acepta lo que firma Node y rechaza alteraciones', { skip: !hayPwsh && 'sin pwsh' }, () => {
	const casos = [];
	for (const [method, url] of URLS) {
		const tok = signRequest({ key: KEY, idEmpresa: 101, method, url });
		casos.push({ method, url, tok, ok: true });
		casos.push({ method, url: `${url}${url.includes('?') ? '&' : '?'}sig=${encodeURIComponent(tok)}`, tok: '', ok: true });
		casos.push({ method: method === 'GET' ? 'DELETE' : 'GET', url, tok, ok: false });
		casos.push({ method, url: `${url}${url.includes('?') ? '&' : '?'}x=1`, tok, ok: false });
		casos.push({ method, url, tok: tok.replace('v1.101.', 'v1.102.'), ok: false });
	}
	const vencido = signRequest({ key: KEY, idEmpresa: 101, method: 'GET', url: '/health', now: Date.now() - 3600_000 });
	casos.push({ method: 'GET', url: '/health', tok: vencido, ok: false });

	for (const rel of SCRIPTS) {
		const ps = `
$ErrorActionPreference = 'Stop'
$SignKey = '${KEY}'; $EmpresaId = '101'; $SkewS = 300; $MaxTtlS = 900
${funcionesDeFirma(rel)}
$casos = [IO.File]::ReadAllText($env:CASOS_JSON) | ConvertFrom-Json
$res = foreach ($c in $casos) {
	$h = @{}; if ($c.tok) { $h['x-imedic-sig'] = $c.tok }
	[bool](Test-Signed ([pscustomobject]@{ RawUrl = $c.url; HttpMethod = $c.method; Headers = $h }))
}
$res -join ','
`;
		const tmp = path.join(os.tmpdir(), `casos-${process.pid}.json`);
		const script = path.join(os.tmpdir(), `firma-${process.pid}.ps1`);
		fs.writeFileSync(tmp, JSON.stringify(casos));
		fs.writeFileSync(script, ps);
		const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-File', script], {
			encoding: 'utf8',
			env: { ...process.env, CASOS_JSON: tmp },
		});
		fs.unlinkSync(tmp);
		fs.unlinkSync(script);
		assert.strictEqual(r.status, 0, r.stderr);
		const got = r.stdout.trim().split(',').map((s) => s === 'True');
		casos.forEach((c, i) => assert.strictEqual(got[i], c.ok, `${rel}: ${c.method} ${c.url} (${c.tok ? 'header' : 'query'})`));
	}
});
