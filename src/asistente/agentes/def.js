function def(spec) {
	return Object.freeze({
		global: false,
		mutante: false,
		plataforma: false,
		sql: false,
		...spec,
	});
}

module.exports = { def };
