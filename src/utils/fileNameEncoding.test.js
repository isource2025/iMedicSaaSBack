const assert = require('assert');
const {
	fileServerFileQuery,
	fileServerFileUrl,
	decodeFileServerPathParam,
	pathLookupCandidates,
	sanitizeFolderName,
} = require('./fileNameEncoding');

const ruta = 'C:\\imedic\\adjuntos\\123 PEÑA JUAN\\estudio.pdf';

const query = fileServerFileQuery(ruta);
assert.ok(query.startsWith('path='), 'query arranca con path=');
assert.ok(!query.includes('Ñ'), 'el query tiene que ir en ASCII');
assert.ok(query.includes('%25'), 'doble-encode deja %25');

const encodedOnce = decodeURIComponent(query.slice('path='.length));
assert.ok(encodedOnce.includes('%'), 'después de un decode todavía está percent-encoded');
assert.strictEqual(decodeURIComponent(encodedOnce), ruta);

assert.strictEqual(decodeFileServerPathParam(encodedOnce), ruta);
assert.strictEqual(decodeFileServerPathParam(ruta), ruta);

const url = fileServerFileUrl('https://files-sarmiento.imedic.com.ar', ruta);
assert.ok(url.startsWith('https://files-sarmiento.imedic.com.ar/file?path='));

const candidates = pathLookupCandidates('C:\\imedic\\adjuntos\\123 PE?A\\a.pdf');
assert.ok(
	candidates.some((c) => c.includes('PEÑA')),
	'candidato con Ñ a partir de PE?A',
);
assert.ok(
	pathLookupCandidates(ruta).some((c) => c.includes('PE_A')),
	'candidato legacy con _ en lugar de Ñ',
);

assert.strictEqual(sanitizeFolderName('peña garcía'), 'PEÑA GARCÍA');

console.log('fileNameEncoding.test.js OK');
