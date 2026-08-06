const { executeQuery } = require('../models/db');

/**
 * Contexto clínico de una visita para la UI de internación (también post-egreso).
 * No depende de que la cama siga ocupada.
 */
async function obtenerContextoClinicoVisita(numeroVisita) {
	const num = parseInt(numeroVisita, 10);
	if (!Number.isFinite(num) || num <= 0) {
		const e = new Error('Número de visita inválido');
		e.statusCode = 400;
		throw e;
	}

	const rows = await executeQuery(
		`
    SELECT TOP 1
      v.NumeroVisita AS numeroVisita,
      CASE
        WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL AND TRY_CAST(v.FechaEgreso AS int) > 0
        THEN 1 ELSE 0
      END AS egresada,
      v.FechaEgreso AS fechaEgresoClarion,
      LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS NombrePaciente,
      LTRIM(RTRIM(ISNULL(p.NumeroDocumento, ''))) AS documentoPaciente,
      p.Sexo AS SexoPaciente,
      sx.Descripcion AS DescripcionSexo,
      d.Descripcion AS DiagnosticoDescripcion,
      c.RazonSocial AS RazonSocialCliente,
      sm.Descripcion AS ServicioMedicoDescripcion,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) AS fechaIngresoSQL,
      CONVERT(VARCHAR(5), v.FECHAADMISIONS, 114) AS horaIngresoSQL,
      COALESCE(
        NULLIF(LTRIM(RTRIM(hc.ValorHabitacionCama)), ''),
        NULLIF(LTRIM(RTRIM(um.ValorHabitacionCama)), ''),
        'EGRESO'
      ) AS numeroCama,
      COALESCE(
        NULLIF(LTRIM(RTRIM(hc.ValorSector)), ''),
        NULLIF(LTRIM(RTRIM(um.ValorSector)), ''),
        ''
      ) AS sector,
      LTRIM(RTRIM(ISNULL(COALESCE(hc.Tipo, um.Tipo), 'cama'))) AS Tipo,
      CASE
        WHEN hc.NumeroVisita = v.NumeroVisita THEN hc.ValorEstadoCama
        ELSE 'E'
      END AS ValorEstadoCama,
      ec.Descripcion AS EstadoDescripcion
    FROM dbo.imVisita v
    LEFT JOIN dbo.imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN dbo.imSexo sx ON p.Sexo = sx.Valor
    LEFT JOIN dbo.imDiagnosticos d ON v.Diagnostico = d.CodigoOMS
    LEFT JOIN dbo.imClientes c ON v.Cliente = c.Valor
    LEFT JOIN dbo.imServiciosMedicos sm ON v.ServicioHospital = sm.Valor
    LEFT JOIN dbo.imHabitacionCamas hc ON hc.NumeroVisita = v.NumeroVisita
    OUTER APPLY (
      SELECT TOP 1
        m.ValorHabitacionCama,
        m.ValorSector,
        cam.Tipo
      FROM dbo.imVisitaMovimiento m
      LEFT JOIN dbo.imHabitacionCamas cam
        ON cam.ValorHabitacionCama = m.ValorHabitacionCama
       AND cam.ValorSector = m.ValorSector
      WHERE m.NumeroVisita = v.NumeroVisita
      ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC
    ) um
    LEFT JOIN dbo.imEstadoCama ec ON ec.Valor = CASE
      WHEN hc.NumeroVisita = v.NumeroVisita THEN hc.ValorEstadoCama
      ELSE 'E'
    END
    WHERE v.NumeroVisita = @p0
    `,
		[{ value: num }],
	);

	if (!rows.length) {
		const e = new Error(`No se encontró la visita ${num}`);
		e.statusCode = 404;
		throw e;
	}

	const r = rows[0];
	const sector = String(r.sector || '').trim();
	const numeroCama = String(r.numeroCama || 'EGRESO').trim();
	const egresada = Number(r.egresada) === 1;

	return {
		id: `${sector || 'VISITA'}-${numeroCama}`,
		sector,
		numeroCama,
		ValorSector: sector,
		ValorHabitacionCama: numeroCama,
		Tipo: r.Tipo || 'cama',
		tipo: r.Tipo || 'cama',
		ValorEstadoCama: egresada ? 'E' : r.ValorEstadoCama,
		EstadoDescripcion: egresada ? 'Egresada' : r.EstadoDescripcion || '',
		estadoDescripcion: egresada ? 'Egresada' : r.EstadoDescripcion || '',
		NumeroVisita: num,
		numeroVisita: num,
		mostrarNumeroVisita: String(num),
		NombrePaciente: r.NombrePaciente || '',
		documentoPaciente: r.documentoPaciente || '',
		DocumentoPaciente: r.documentoPaciente || '',
		SexoPaciente: r.SexoPaciente || '',
		DescripcionSexo: r.DescripcionSexo || '',
		descripcionSexo: r.DescripcionSexo || '',
		DiagnosticoDescripcion: r.DiagnosticoDescripcion || '',
		diagnosticoDescripcion: r.DiagnosticoDescripcion || '',
		RazonSocialCliente: r.RazonSocialCliente || '',
		razonSocialCliente: r.RazonSocialCliente || '',
		ServicioMedicoDescripcion: r.ServicioMedicoDescripcion || '',
		servicioMedicoDescripcion: r.ServicioMedicoDescripcion || '',
		fechaIngresoSQL: r.fechaIngresoSQL || '',
		horaIngresoSQL: r.horaIngresoSQL || '',
		egresada,
		fechaEgresoClarion: r.fechaEgresoClarion != null ? Number(r.fechaEgresoClarion) : 0,
		Observaciones: egresada ? 'Visita egresada — se puede agregar información clínica' : '',
	};
}

module.exports = {
	obtenerContextoClinicoVisita,
};
