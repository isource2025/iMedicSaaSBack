const test = require('node:test');
const assert = require('node:assert');
const {
	decodeBufferPreferUtf8,
	repararTextoClarionAnsi,
	repararStringsDeep,
	normalizarTextoParaClarionAnsi,
	sanitizarTextoParaBd,
} = require('./clarionText');

const FFFD_LATIN1 = '\u00EF\u00BF\u00BD'; // "ï¿½"

test('U+FFFD legítimo en UTF-8 no se convierte en "ï¿½"', () => {
	const out = decodeBufferPreferUtf8(Buffer.from('ORGO\uFFFD, CECILIA', 'utf8'));
	assert.strictEqual(out, 'ORGO\uFFFD, CECILIA');
	assert.ok(!out.includes(FFFD_LATIN1));
});

test('buffer ANSI (CP1252) y UTF-8 válido se decodifican bien', () => {
	assert.strictEqual(decodeBufferPreferUtf8(Buffer.from([0x4f, 0x52, 0x47, 0x4f, 0xd1])), 'ORGO\u00D1');
	assert.strictEqual(decodeBufferPreferUtf8(Buffer.from('ACU\u00D1A', 'utf8')), 'ACU\u00D1A');
});

test('"ï¿½" ya materializado se normaliza a U+FFFD y nunca se persiste', () => {
	assert.strictEqual(repararTextoClarionAnsi(`ORGO${FFFD_LATIN1}`), 'ORGO\uFFFD');
	assert.strictEqual(normalizarTextoParaClarionAnsi(`ORGO${FFFD_LATIN1}, X`), 'ORGO, X');
	assert.strictEqual(sanitizarTextoParaBd(`ORGO${FFFD_LATIN1}, X`), 'ORGO, X');
});

test('restaurarEnie recupera la Ñ perdida en datos de persona, sin tocar "ATENCI�N"', () => {
	const out = repararStringsDeep(
		{ a: `ORGO${FFFD_LATIN1}, CECILIA`, b: 'ACU\uFFFDA', c: 'ATENCI\uFFFDN' },
		0,
		{ restaurarEnie: true },
	);
	assert.strictEqual(out.a, 'ORGO\u00D1, CECILIA');
	assert.strictEqual(out.b, 'ACU\u00D1A');
	assert.strictEqual(out.c, 'ATENCI\uFFFDN');
});
