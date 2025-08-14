// Servicio para manejar trabajos (empleos) asociados a pacientes
const { executeQuery } = require('../models/db');

// Asegura tabla impacientetrabajos (si no existe) - estructura básica adaptable
const ensureJobsTable = async () => {
	const ddl = `IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='impacientetrabajos' AND xtype='U')
BEGIN
  CREATE TABLE impacientetrabajos(
    ID INT IDENTITY(1,1) PRIMARY KEY,
    IDPaciente INT NOT NULL,
    RazonSocial NVARCHAR(80) NULL,
    DocumentoEmpresa NVARCHAR(40) NULL,
    CuitEmpresa NVARCHAR(20) NULL,
    DomicilioEmpresa NVARCHAR(120) NULL,
    TelefonoEmpresa NVARCHAR(40) NULL,
    Ocupacion NVARCHAR(10) NULL,
    SituacionLaboral NVARCHAR(5) NULL,
    NivelEstudios NVARCHAR(5) NULL,
    FechaCreacion DATETIME DEFAULT GETDATE()
  );
  CREATE INDEX IX_impacientetrabajos_IDPaciente ON impacientetrabajos(IDPaciente);
END`;
	await executeQuery(ddl);
};

const insertJobs = async (idPaciente, trabajos = []) => {
	if (!trabajos || !trabajos.length) return [];
	await ensureJobsTable();
	const inserted = [];
	for (const t of trabajos) {
		const q = `INSERT INTO impacientetrabajos (IDPaciente, RazonSocial, DocumentoEmpresa, CuitEmpresa, DomicilioEmpresa, TelefonoEmpresa, Ocupacion, SituacionLaboral, NivelEstudios)
               VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8);
               SELECT SCOPE_IDENTITY() AS ID;`;
		const params = [
			{ value: idPaciente },
			{ value: t.RazonSocial || null },
			{ value: t.DocumentoEmpresa || null },
			{ value: t.CuitEmpresa || null },
			{ value: t.DomicilioEmpresa || null },
			{ value: t.TelefonoEmpresa || null },
			{ value: t.Ocupacion || null },
			{ value: t.SituacionLaboral || null },
			{ value: t.NivelEstudios || null },
		];
		const r = await executeQuery(q, params);
		inserted.push({ ...t, ID: r[0].ID });
	}
	return inserted;
};

const getJobsByPatient = async (idPaciente) => {
	await ensureJobsTable();
	const q = `SELECT ID, IDPaciente, RazonSocial, DocumentoEmpresa, CuitEmpresa, DomicilioEmpresa, TelefonoEmpresa, Ocupacion, SituacionLaboral, NivelEstudios
             FROM impacientetrabajos WHERE IDPaciente=@p0 ORDER BY ID`;
	return await executeQuery(q, [{ value: idPaciente }]);
};

const replaceJobs = async (idPaciente, trabajos = []) => {
	await ensureJobsTable();
	// Borrar existentes
	await executeQuery('DELETE FROM impacientetrabajos WHERE IDPaciente=@p0', [
		{ value: idPaciente },
	]);
	if (!trabajos.length) return [];
	return await insertJobs(idPaciente, trabajos);
};

module.exports = { ensureJobsTable, insertJobs, getJobsByPatient, replaceJobs };
