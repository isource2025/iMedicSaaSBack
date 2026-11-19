const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createConfinement, parseRootList } = require('./rootConfinement');

const sinLinks = () => null;

test('Windows: solo rutas dentro de las raíces (local y UNC, sin distinguir mayúsculas)', () => {
	const c = createConfinement(['E:\\imedic\\adjuntos', '\\\\server\\Imagenes\\Vidal'], {
		pathImpl: path.win32,
		realpath: sinLinks,
	});
	assert.ok(c.contains('E:\\imedic\\adjuntos\\123 PEREZ\\a.pdf'));
	assert.ok(c.contains('e:\\IMEDIC\\Adjuntos\\x.pdf'));
	assert.ok(c.contains('\\\\SERVER\\imagenes\\vidal\\1\\b.jpg'));
	assert.ok(!c.contains('E:\\imedic\\adjuntos\\..\\..\\Windows\\win.ini'));
	assert.ok(!c.contains('E:\\imedic\\adjuntos2\\a.pdf'));
	assert.ok(!c.contains('C:\\Windows\\System32\\config\\SAM'));
	assert.ok(!c.contains('\\\\server\\Imagenes\\Otra\\a.pdf'));
	assert.ok(!c.contains('E:\\imedic\\adjuntos\\a.pdf\0.txt'));
	assert.ok(!c.contains(''));
});

test('un link/junction que apunta afuera queda bloqueado', () => {
	const c = createConfinement(['/data/adjuntos'], {
		pathImpl: path.posix,
		realpath: (p) => (p.startsWith('/data/adjuntos/link') ? '/etc/passwd' : null),
	});
	assert.ok(c.contains('/data/adjuntos/ok.pdf'));
	assert.ok(!c.contains('/data/adjuntos/link/x'));
});

test('sin raíces no permite nada', () => {
	assert.ok(!createConfinement([], { pathImpl: path.win32, realpath: sinLinks }).contains('C:\\a'));
});

test('parseRootList', () => {
	assert.deepStrictEqual(parseRootList(' E:\\a ; \\\\srv\\b|C:\\c\n'), ['E:\\a', '\\\\srv\\b', 'C:\\c']);
	assert.deepStrictEqual(parseRootList(''), []);
});
