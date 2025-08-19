// Servicio para manejar trabajos (empleos) asociados a pacientes
const { executeQuery } = require('../models/db');

const insertJobs = async (idPaciente, trabajos = []) => {
	if (!trabajos || !trabajos.length) return [];

	const inserted = [];
	for (const t of trabajos) {
		const q = `INSERT INTO imPacientesTrabajos (IDPaciente, RazonSocial, CuitEmpresa, DomicilioEmpresa, TelefonoEmpresa)
               VALUES (@p0,@p1,@p2,@p3,@p4);
               SELECT SCOPE_IDENTITY() AS ID;`;
		const params = [
			{ value: idPaciente },
			{ value: t.RazonSocial || null },
			{ value: t.CuitEmpresa || null },
			{ value: t.DomicilioEmpresa || null },
			{ value: t.TelefonoEmpresa || null },
		];
		const r = await executeQuery(q, params);
		inserted.push({ ...t, ID: r[0].ID });
	}
	return inserted;
};

const getJobsByPatient = async (idPaciente) => {
	const q = `SELECT ID, IDPaciente, RazonSocial, CuitEmpresa, DomicilioEmpresa, TelefonoEmpresa
             FROM imPacientesTrabajos WHERE IDPaciente=@p0 ORDER BY ID`;
	return await executeQuery(q, [{ value: idPaciente }]);
};

const replaceJobs = async (idPaciente, trabajos = []) => {
	// Borrar existentes
	await executeQuery('DELETE FROM imPacientesTrabajos WHERE IDPaciente=@p0', [
		{ value: idPaciente },
	]);
	if (!trabajos.length) return [];
	return await insertJobs(idPaciente, trabajos);
};

module.exports = { insertJobs, getJobsByPatient, replaceJobs };
