/**
 * Una empresa = un IdEmpresa. adminvidal (y similares) a veces tienen
 * dos filas imPassword / imPersonalEmpresas para el mismo hospital.
 */

function scoreCredencialEmpresa(item) {
	const u = item?.usuario || item || {};
	const grupo = Number(u.Grupo ?? item.Grupo ?? 0);
	const rol = String(u.RolNombre || item.RolNombre || '').trim().toUpperCase();
	let s = 0;
	if (grupo === 11) s += 30;
	if (rol === 'ADMIN' || rol === 'SUPER_ADMIN') s += 20;
	if (rol === 'MEDICO') s += 5;
	return s;
}

function dedupeEmpresasPorId(list) {
	const map = new Map();
	for (const item of list || []) {
		const id = Number(item?.idEmpresa);
		if (!Number.isFinite(id) || id <= 0) continue;
		const prev = map.get(id);
		if (!prev) {
			map.set(id, item);
			continue;
		}
		const chosen = scoreCredencialEmpresa(item) > scoreCredencialEmpresa(prev) ? item : prev;
		map.set(id, chosen);
		const vpPrev = prev.usuario?.ValorPersonal ?? prev.valorPersonal;
		const vpNew = item.usuario?.ValorPersonal ?? item.valorPersonal;
		if (Number(vpPrev) !== Number(vpNew)) {
			console.warn(
				`[auth] usuario con más de una credencial en empresa ${id} (ValorPersonal ${vpPrev} y ${vpNew}); se usa una sola`,
			);
		}
	}
	return [...map.values()];
}

module.exports = { dedupeEmpresasPorId };
