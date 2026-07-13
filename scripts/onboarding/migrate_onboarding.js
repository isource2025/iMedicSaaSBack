#!/usr/bin/env node
/**
 * Migración onboarding: BD origen legado → iMedic (tenant limpio).
 *
 * Alcance: catálogos, sectores, camas, prestadores, pacientes, internaciones, admin.
 * Fuera de alcance: HC, medicamentos, facturación/convenios.
 *
 *   node scripts/onboarding/prepare_target_db.js --target-db MiCliente
 *   npm run onboarding:migrate -- --source-db Origen --target-db MiCliente --dry-run
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const {
	sqlConfig,
	truncStr,
	resolveSectorFromCatalog,
	loadSectorCatalog,
	loadBedCatalog,
	normalizeHabitacionCode,
	closeStaleInternaciones,
	clarionToDateTime,
	parseMatricula,
	parseArgs,
} = require('./lib');

const PHASES = [
	'schema',
	'catalogos',
	'sectores',
	'habitaciones',
	'prestadores',
	'pacientes',
	'internaciones',
	'admin',
];

const SQL_PRESTADORES_PROFESIONALES = `
  SELECT p.*
  FROM dbo.Prestadores p
  WHERE (
    p.NROMATRICULA IS NOT NULL
    AND LTRIM(RTRIM(CAST(p.NROMATRICULA AS VARCHAR(20)))) <> ''
    AND LTRIM(RTRIM(CAST(p.NROMATRICULA AS VARCHAR(20)))) <> '0'
  ) OR (
    p.FECHARECIBIDO IS NOT NULL AND p.FECHARECIBIDO > 0
  )
`;

const ADMIN_VALOR_RESERVADO = 999001;

async function log(targetPool, fase, nivel, mensaje, detalle) {
	const line = `[${fase}] ${mensaje}`;
	if (nivel === 'ERROR') console.error(line, detalle || '');
	else console.log(line);
	if (targetPool && !targetPool._dryRun) {
		await targetPool
			.request()
			.input('fase', sql.VarChar(40), fase)
			.input('nivel', sql.VarChar(10), nivel)
			.input('msg', sql.NVarChar(500), mensaje.slice(0, 500))
			.input('det', sql.NVarChar(sql.MAX), detalle ? String(detalle).slice(0, 4000) : null)
			.query(
				`INSERT INTO dbo._onboardingMigracionLog (Fase, Nivel, Mensaje, Detalle) VALUES (@fase, @nivel, @msg, @det)`,
			)
			.catch(() => {});
	}
}

async function upsertMap(targetPool, { entidad, sourceKey, sourceId, imedicId, imedicKey, metadata, dryRun }) {
	if (dryRun) return;
	await targetPool
		.request()
		.input('ent', sql.VarChar(40), entidad)
		.input('skey', sql.VarChar(80), sourceKey)
		.input('sid', sql.Int, sourceId ?? null)
		.input('iid', sql.Int, imedicId ?? null)
		.input('ikey', sql.VarChar(40), imedicKey ?? null)
		.input('meta', sql.NVarChar(sql.MAX), metadata ? JSON.stringify(metadata) : null)
		.query(`
      MERGE dbo._onboardingMigracionMap AS t
      USING (SELECT @ent AS Entidad, @skey AS SourceKey) AS s
      ON t.Entidad = s.Entidad AND t.SourceKey = s.SourceKey
      WHEN MATCHED THEN UPDATE SET SourceId=@sid, ImedicId=@iid, ImedicKey=@ikey, MetadataJson=@meta
      WHEN NOT MATCHED THEN INSERT (Entidad, SourceKey, SourceId, ImedicId, ImedicKey, MetadataJson)
      VALUES (@ent, @skey, @sid, @iid, @ikey, @meta);
    `);
}

async function getMapId(targetPool, entidad, sourceKey) {
	const r = await targetPool
		.request()
		.input('ent', sql.VarChar(40), entidad)
		.input('skey', sql.VarChar(80), sourceKey)
		.query(`SELECT TOP 1 ImedicId FROM dbo._onboardingMigracionMap WHERE Entidad=@ent AND SourceKey=@skey`);
	return r.recordset[0]?.ImedicId ?? null;
}

async function resolvePrestadorValor(targetPool, codigoPrestador) {
	if (!codigoPrestador) return 0;
	return (await getMapId(targetPool, 'prestador_cod', `COD:${codigoPrestador}`)) || 0;
}

async function resolveSectorValor(targetPool, rawCode, catalog) {
	const fromCatalog = resolveSectorFromCatalog(catalog, rawCode);
	if (fromCatalog) return fromCatalog;

	const raw = String(rawCode || '').trim();
	if (!raw) return null;
	const mapped = await targetPool
		.request()
		.input('ent', sql.VarChar(40), 'sector')
		.input('skey', sql.VarChar(80), raw)
		.query(`SELECT TOP 1 ImedicKey FROM dbo._onboardingMigracionMap WHERE Entidad=@ent AND SourceKey=@skey`);
	return mapped.recordset[0]?.ImedicKey || null;
}

async function phaseSchema(targetPool, opts) {
	const ddl = fs.readFileSync(path.join(__dirname, 'setup_migration_schema.sql'), 'utf8');
	if (opts.dryRun) {
		await log(targetPool, 'schema', 'INFO', 'DRY-RUN: tablas _onboardingMigracion*');
		return {};
	}
	await targetPool.request().query(ddl);
	await log(targetPool, 'schema', 'INFO', 'Tablas auxiliares listas');
	return {};
}

async function phaseCatalogos(sourcePool, targetPool, opts) {
	const used = await sourcePool.request().query(`
    SELECT DISTINCT l.LOCALIDADESID, l.NOMBRE
    FROM dbo.Localidades l
    WHERE l.LOCALIDADESID IN (
      SELECT LOCALIDADESID FROM dbo.Pacientes WHERE LOCALIDADESID IS NOT NULL
      UNION SELECT LOCALIDADESID FROM dbo.Prestadores WHERE LOCALIDADESID IS NOT NULL
    )
    ORDER BY l.LOCALIDADESID
  `);
	let inserted = 0;
	for (const row of used.recordset || []) {
		const ex = await targetPool.request().input('v', sql.Int, row.LOCALIDADESID)
			.query(`SELECT 1 FROM dbo.imLocalidades WHERE Valor=@v`);
		if (ex.recordset.length) continue;
		if (!opts.dryRun) {
			await targetPool
				.request()
				.input('v', sql.Int, row.LOCALIDADESID)
				.input('d', sql.VarChar(40), truncStr(row.NOMBRE, 40) || `Loc ${row.LOCALIDADESID}`)
				.query(`INSERT INTO dbo.imLocalidades (Valor, NombreLocalidad) VALUES (@v, @d)`);
		}
		inserted++;
	}
	await log(targetPool, 'catalogos', 'INFO', `${inserted} localidades nuevas`);
	return { inserted };
}

async function phaseSectores(sourcePool, targetPool, opts) {
	const catalog = opts.sectorCatalog || (await loadSectorCatalog(sourcePool));
	opts.sectorCatalog = catalog;

	let inserted = 0;
	for (const entry of catalog.values()) {
		const ex = await targetPool.request().input('v', sql.VarChar(4), entry.valor)
			.query(`SELECT 1 FROM dbo.imSectores WHERE Valor=@v`);
		if (!ex.recordset.length && !opts.dryRun) {
			await targetPool
				.request()
				.input('v', sql.VarChar(4), entry.valor)
				.input('vs', sql.VarChar(4), `${entry.valor} `.slice(0, 4))
				.input('d', sql.VarChar(40), entry.descripcion)
				.input('a', sql.Char(1), entry.ambInt)
				.query(
					`INSERT INTO dbo.imSectores (Valor, ValorServicio, Descripcion, ProtocoloN, AmbInt) VALUES (@v,@vs,@d,0,@a)`,
				);
			inserted++;
		}

		await upsertMap(targetPool, {
			entidad: 'sector',
			sourceKey: entry.nombre,
			imedicKey: entry.valor,
			dryRun: opts.dryRun,
		});
	}

	await log(
		targetPool,
		'sectores',
		'INFO',
		`${inserted} imSectores desde dbo.Sector (${catalog.size} sectores oficiales)`,
	);
	return { inserted, total: catalog.size };
}

async function phaseHabitaciones(sourcePool, targetPool, opts) {
	const catalog = opts.sectorCatalog || (await loadSectorCatalog(sourcePool));
	opts.sectorCatalog = catalog;
	const beds = await loadBedCatalog(sourcePool, catalog);
	let inserted = 0;

	for (const bed of beds) {
		const ex = await targetPool
			.request()
			.input('vs', sql.VarChar(4), bed.sectorVal)
			.input('vh', sql.VarChar(4), bed.habCode)
			.query(`SELECT 1 FROM dbo.imHabitacionCamas WHERE ValorSector=@vs AND ValorHabitacionCama=@vh`);
		if (ex.recordset.length) continue;

		if (!opts.dryRun) {
			await targetPool
				.request()
				.input('vs', sql.VarChar(4), bed.sectorVal)
				.input('vh', sql.VarChar(4), bed.habCode)
				.input('est', sql.Char(1), 'U')
				.query(`
          INSERT INTO dbo.imHabitacionCamas (ValorSector, ValorHabitacionCama, ValorEstadoCama, NumeroVisita)
          VALUES (@vs, @vh, @est, 0)
        `);
			inserted++;
		}
	}

	const bedIndex = new Set(beds.map((b) => `${b.sectorVal}|${b.habCode}`));
	let occupied = 0;
	if (!opts.dryRun) {
		await targetPool.request().query(`
      UPDATE dbo.imHabitacionCamas SET ValorEstadoCama='U', NumeroVisita=0
    `).catch(() => {});

		const activas = await sourcePool.request().query(`
      SELECT INTERNACIONESID, SECTOR, HABITACION
      FROM dbo.Internaciones
      WHERE (FECHAEGRESO IS NULL OR FECHAEGRESO = 0)
        AND LTRIM(RTRIM(HABITACION)) <> ''
    `);

		for (const a of activas.recordset || []) {
			const sectorVal = resolveSectorFromCatalog(catalog, a.SECTOR);
			const hab = normalizeHabitacionCode(a.HABITACION);
			if (!sectorVal || !hab || !bedIndex.has(`${sectorVal}|${hab}`)) continue;

			const r = await targetPool
				.request()
				.input('nv', sql.Int, a.INTERNACIONESID)
				.input('vs', sql.VarChar(4), sectorVal)
				.input('vh', sql.VarChar(4), hab)
				.query(`
          UPDATE dbo.imHabitacionCamas
          SET NumeroVisita=@nv, ValorEstadoCama='O'
          WHERE ValorSector=@vs AND ValorHabitacionCama=@vh
        `);
			if (r.rowsAffected[0]) occupied++;
		}
	}

	await log(
		targetPool,
		'habitaciones',
		'INFO',
		`${inserted} camas nuevas (${beds.length} desde Sectores↔Sector), ${occupied} ocupadas`,
	);

	if (!opts.dryRun && opts.closeStale !== false) {
		const stale = await closeStaleInternaciones(targetPool, {
			referenceDate: process.env.ONBOARDING_REFERENCE_DATE || undefined,
			months: 1,
		});
		await log(
			targetPool,
			'habitaciones',
			'INFO',
			`${stale.closed} internaciones abiertas >1 mes cerradas (ref ${stale.referenceDate}), ${stale.bedsOccupied} camas activas`,
		);
	}

	return { inserted, beds: beds.length, occupied };
}

async function phasePrestadores(sourcePool, targetPool, opts) {
	const rows = (await sourcePool.request().query(`${SQL_PRESTADORES_PROFESIONALES} ORDER BY PRESTADORESID`))
		.recordset;
	let nextValor =
		(await targetPool.request().query(`SELECT ISNULL(MAX(Valor),0) AS m FROM dbo.imPersonal WHERE Valor < 900000`))
			.recordset[0]?.m || 0;
	const usedMatriculas = new Set(
		(
			await targetPool.request().query(
				`SELECT Matricula FROM dbo.imPersonal WHERE Matricula IS NOT NULL`,
			)
		).recordset.map((r) => r.Matricula),
	);
	let inserted = 0;

	function allocMatricula(p, valor) {
		let m = parseMatricula(p.NROMATRICULA);
		if (!m || usedMatriculas.has(m)) m = valor;
		while (usedMatriculas.has(m)) m += 1;
		usedMatriculas.add(m);
		return m;
	}

	for (const p of rows) {
		let valor = p.PRESTADORESID;
		const ex = await targetPool.request().input('v', sql.Int, valor)
			.query(`SELECT 1 FROM dbo.imPersonal WHERE Valor=@v`);
		if (ex.recordset.length) valor = ++nextValor;
		else nextValor = Math.max(nextValor, valor);

		const matricula = allocMatricula(p, valor);

		if (!opts.dryRun) {
			await targetPool
				.request()
				.input('v', sql.Int, valor)
				.input('mat', sql.Int, matricula)
				.input('matN', sql.Int, parseMatricula(p.NROMATRICULANACIONAL))
				.input('td', sql.VarChar(3), truncStr(p.TIPODOCUMENTO, 3))
				.input('num', sql.Int, p.NRODOCUMENTO || null)
				.input('nom', sql.VarChar(120), truncStr(p.NOMBRE, 120) || `Prestador ${p.PRESTADORESID}`)
				.input('dom', sql.VarChar(120), truncStr(p.DOMICILIO, 120))
				.input('tel', sql.VarChar(15), truncStr(p.TELEFONOS, 15))
				.input('mail', sql.VarChar(40), truncStr(p.EMAIL, 40))
				.input('loc', sql.Int, p.LOCALIDADESID || null)
				.input('esp', sql.SmallInt, p.ESPECIALIDADESID || null)
				.input('fn', sql.Int, p.FECHANACIMIENTO || null)
				.input('cuit', sql.VarChar(13), p.CUIT != null ? String(Math.trunc(p.CUIT)) : null)
				.input('est', sql.TinyInt, p.HABILITADO === 'N' ? 0 : 1)
				.query(`
          INSERT INTO dbo.imPersonal (
            Valor, Matricula, MatriculaNacional, TipoDocumento, Numero, ApellidoNombre,
            Domicilio, Telefono, email, ValorLocalidad, ValorEspecialidad, FechaNacimiento, CUIT, Estado, Rol
          ) VALUES (@v,@mat,@matN,@td,@num,@nom,@dom,@tel,@mail,@loc,@esp,@fn,@cuit,@est,'2')
        `);
			inserted++;
		}
		await upsertMap(targetPool, {
			entidad: 'prestador',
			sourceKey: `ID:${p.PRESTADORESID}`,
			sourceId: p.PRESTADORESID,
			imedicId: valor,
			metadata: { matricula: p.NROMATRICULA },
			dryRun: opts.dryRun,
		});
		if (p.CODIGOPRESTADOR != null) {
			await upsertMap(targetPool, {
				entidad: 'prestador_cod',
				sourceKey: `COD:${p.CODIGOPRESTADOR}`,
				sourceId: p.CODIGOPRESTADOR,
				imedicId: valor,
				dryRun: opts.dryRun,
			});
		}
	}
	await log(targetPool, 'prestadores', 'INFO', `${inserted} profesionales → imPersonal (${rows.length} filtrados)`);
	return { inserted, total: rows.length };
}

async function phasePacientes(sourcePool, targetPool, opts) {
	const batchSize = 500;
	let offset = 0;
	let inserted = 0;
	const total = (await sourcePool.request().query(`SELECT COUNT(*) AS c FROM dbo.Pacientes`)).recordset[0].c;

	while (offset < total) {
		const batch = await sourcePool.request().query(`
      SELECT * FROM dbo.Pacientes ORDER BY PACIENTESID
      OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY
    `);
		for (const p of batch.recordset) {
			const id = p.PACIENTESID;
			const ex = await targetPool.request().input('id', sql.Int, id)
				.query(`SELECT 1 FROM dbo.imPacientes WHERE IdPaciente=@id`);
			if (ex.recordset.length) continue;

			if (!opts.dryRun) {
				await targetPool
					.request()
					.input('id', sql.Int, id)
					.input('lista', sql.VarChar(80), String(id))
					.input('alt', sql.Int, p.CODIGOPACIENTE || id)
					.input('nom', sql.VarChar(40), truncStr(p.NOMBRE, 40) || `Paciente ${id}`)
					.input('td', sql.VarChar(3), truncStr(p.TIPODOCUMENTO, 3))
					.input('nd', sql.Int, p.NRODOCUMENTO || null)
					.input('dom', sql.VarChar(80), truncStr(p.DOMICILIO, 80))
					.input('loc', sql.Int, p.LOCALIDADESID || null)
					.input('sex', sql.Char(1), truncStr(p.SEXO, 1))
					.input('fn', sql.Int, p.FECHANACIMIENTO || null)
					.input('tel', sql.NVarChar(20), truncStr(p.TELEFONOS, 20))
					.input('mail', sql.VarChar(80), truncStr(p.EMAIL, 80))
					.input('nc', sql.Int, p.CONVENIOSID || null)
					.input('ssn', sql.VarChar(40), truncStr(p.NROAFILIADO, 40))
					.input('cuit', sql.VarChar(13), p.CUIL != null ? String(Math.trunc(p.CUIL)) : null)
					.input('obs', sql.VarChar(1000), truncStr(p.OBSERVACIONES, 1000))
					.input('fob', sql.Int, p.FECHAOBITO || null)
					.query(`
            SET IDENTITY_INSERT dbo.imPacientes ON;
            INSERT INTO dbo.imPacientes (
              IdPaciente, ListaIDPaciente, IDPacienteAlt, ApellidoyNombre, TipoDocumento, NumeroDocumento,
              Domicilio, ValorLocalidad, Sexo, FechaNacimiento, TelefonoParticular, Mail,
              NumeroCuenta, NumeroSSN, CUIT, Observaciones, FechaDefuncion
            ) VALUES (@id,@lista,@alt,@nom,@td,@nd,@dom,@loc,@sex,@fn,@tel,@mail,@nc,@ssn,@cuit,@obs,@fob);
            SET IDENTITY_INSERT dbo.imPacientes OFF;
          `);
				inserted++;
			}
			await upsertMap(targetPool, {
				entidad: 'paciente',
				sourceKey: String(id),
				sourceId: id,
				imedicId: id,
				dryRun: opts.dryRun,
			});
		}
		offset += batchSize;
	}

	let convUpd = 0;
	if (!opts.dryRun) {
		const convP = (await sourcePool.request().query(`SELECT * FROM dbo.ConvPacientes`)).recordset;
		for (const cp of convP) {
			if (!cp.PACIENTESID) continue;
			const r = await targetPool
				.request()
				.input('id', sql.Int, cp.PACIENTESID)
				.input('ssn', sql.VarChar(40), truncStr(cp.NROAFILIADO, 40))
				.input('nc', sql.Int, cp.CONVENIOSID || null)
				.query(`
          UPDATE dbo.imPacientes SET
            NumeroSSN = CASE WHEN NumeroSSN IS NULL OR LTRIM(RTRIM(NumeroSSN))='' THEN @ssn ELSE NumeroSSN END,
            NumeroCuenta = CASE WHEN NumeroCuenta IS NULL OR NumeroCuenta=0 THEN @nc ELSE NumeroCuenta END
          WHERE IdPaciente=@id
        `);
			convUpd += r.rowsAffected[0] || 0;
		}
	}

	await log(targetPool, 'pacientes', 'INFO', `${inserted} imPacientes, ConvPacientes: ${convUpd} enriquecidos`);
	return { inserted, total, convUpd };
}

async function phaseInternaciones(sourcePool, targetPool, opts) {
	const batchSize = 200;
	let offset = 0;
	let visitas = 0;
	let movimientos = 0;
	const total = (await sourcePool.request().query(`SELECT COUNT(*) AS c FROM dbo.Internaciones`)).recordset[0].c;

	while (offset < total) {
		const batch = await sourcePool.request().query(`
      SELECT * FROM dbo.Internaciones ORDER BY INTERNACIONESID
      OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY
    `);
		for (const i of batch.recordset) {
			const numVisita = i.INTERNACIONESID;
			const ex = await targetPool.request().input('nv', sql.Int, numVisita)
				.query(`SELECT 1 FROM dbo.imVisita WHERE NUMEROVISITA=@nv`);
			if (ex.recordset.length) continue;

			const sector = await resolveSectorValor(targetPool, i.SECTOR, opts.sectorCatalog);
			const hab = normalizeHabitacionCode(i.HABITACION);
			const clase = i.ESAMBULATORIO ? 'A' : 'I';
			const doctorAdmisor = (await resolvePrestadorValor(targetPool, i.PROFINTERNA)) || 0;
			const admision = clarionToDateTime(i.FECHAINGRESO, i.HORAINGRESO);
			const diag = truncStr(i.CODIGODIAGNOSTICOCIE10 || i.DIAGNOSTICO, 8) || '';

			if (!opts.dryRun) {
				await targetPool
					.request()
					.input('nv', sql.Int, numVisita)
					.input('pac', sql.Int, i.PACIENTESID)
					.input('adm', sql.DateTime, admision)
					.input('sec', sql.VarChar(4), sector)
					.input('hab', sql.VarChar(4), hab)
					.input('cls', sql.Char(1), clase)
					.input('docA', sql.Int, doctorAdmisor)
					.input('cli', sql.Int, i.CONVENIOSID || 0)
					.input('diag', sql.VarChar(8), diag)
					.input('feg', sql.Int, i.FECHAEGRESO || null)
					.input('heg', sql.Int, i.HORAEGRESO || null)
					.input('nroInt', sql.VarChar(40), i.NROINTERNACION != null ? String(i.NROINTERNACION) : null)
					.query(`
            INSERT INTO dbo.imVisita (
              NUMEROVISITA, IDPACIENTE, IDDESCONOCIDA, FECHAADMISIONS, TIPOADMISION,
              VALORSECTOR, VALORHABITACIONCAMA, CLASEPACIENTE,
              DOCTORADMISOR, DIAGNOSTICO, CLIENTE, NUMEROINTERNACION,
              FECHAEGRESO, HORAEGRESO, STATUS
            ) VALUES (
              @nv, @pac, 0, @adm, ' ',
              @sec, @hab, @cls,
              @docA, @diag, @cli, @nroInt,
              @feg, @heg, 0
            )
          `);
				visitas++;
			}

			await upsertMap(targetPool, {
				entidad: 'internacion',
				sourceKey: String(numVisita),
				sourceId: numVisita,
				imedicId: numVisita,
				dryRun: opts.dryRun,
			});
		}
		offset += batchSize;
		if (offset % 5000 === 0) await log(targetPool, 'internaciones', 'INFO', `Visitas ${Math.min(offset, total)}/${total}`);
	}

	const segTotal = (await sourcePool.request().query(`SELECT COUNT(*) AS c FROM dbo.SegInternaciones`)).recordset[0].c;
	offset = 0;
	const segBatch = 500;
	while (offset < segTotal) {
		const batch = await sourcePool.request().query(`
      SELECT * FROM dbo.SegInternaciones ORDER BY SEGINTERNACIONESID
      OFFSET ${offset} ROWS FETCH NEXT ${segBatch} ROWS ONLY
    `);
		for (const m of batch.recordset) {
			if (!m.INTERNACIONESID) continue;
			const secEntry = await resolveSectorValor(targetPool, m.SECTOR, opts.sectorCatalog);
			if (!opts.dryRun) {
				await targetPool
					.request()
					.input('nv', sql.Int, m.INTERNACIONESID)
					.input('sec', sql.VarChar(4), secEntry)
					.input('hab', sql.VarChar(4), normalizeHabitacionCode(m.HABITACION))
					.input('fa', sql.Int, m.FECHAINGRESO || 0)
					.input('ha', sql.Int, m.HORAINGRESO || 0)
					.input('fe', sql.Int, m.FECHAEGRESO || null)
					.input('he', sql.Int, m.HORAEGRESO || null)
					.query(`
            INSERT INTO dbo.imVisitaMovimiento (
              NumeroVisita, ValorSector, ValorHabitacionCama,
              FechaAdmision, HoraAdmision, FechaEgreso, HoraEgreso, Status
            ) VALUES (@nv, @sec, @hab, @fa, @ha, @fe, @he, 0)
          `)
					.catch(() => {});
				movimientos++;
			}
		}
		offset += segBatch;
	}

	await log(
		targetPool,
		'internaciones',
		'INFO',
		`${visitas} imVisita, ${movimientos} imVisitaMovimiento. Egreso: FECHAEGRESO/HORAEGRESO de Internaciones.`,
	);
	return { visitas, movimientos, total };
}

async function phaseAdmin(targetPool, opts) {
	const user = String(opts.adminUser).trim();
	const pass = String(opts.adminPass);
	const valor = ADMIN_VALOR_RESERVADO;

	if (!user || pass.length < 4) {
		throw new Error('Admin: --admin-user y --admin-pass (mín. 4 chars) requeridos');
	}

	if (opts.dryRun) {
		await log(targetPool, 'admin', 'INFO', `DRY-RUN: crearía admin "${user}" ValorPersonal=${valor}`);
		return { dryRun: true };
	}

	const exP = await targetPool.request().input('v', sql.Int, valor)
		.query(`SELECT 1 FROM dbo.imPersonal WHERE Valor=@v`);
	if (!exP.recordset.length) {
		await targetPool
			.request()
			.input('v', sql.Int, valor)
			.input('mat', sql.Int, valor)
			.query(`
        INSERT INTO dbo.imPersonal (
          Valor, Matricula, ApellidoNombre, TipoDocumento, Numero, Estado, Rol
        ) VALUES (@v, @mat, 'Administrador, Sistema', 'DNI', 90000001, 1, '1')
      `);
	} else {
		await targetPool.request().input('v', sql.Int, valor)
			.query(`UPDATE dbo.imPersonal SET Rol='1', Estado=1 WHERE Valor=@v`);
	}

	const exU = await targetPool.request().input('u', sql.VarChar(50), user)
		.query(`SELECT ValorPersonal FROM dbo.imPassword WHERE UPPER(RTRIM(NombreRed))=UPPER(RTRIM(@u))`);
	let vp = valor;
	if (exU.recordset.length) {
		vp = exU.recordset[0].ValorPersonal;
		await targetPool
			.request()
			.input('p', sql.VarChar(255), pass)
			.input('vp', sql.Int, vp)
			.query(`UPDATE dbo.imPassword SET Password=@p WHERE ValorPersonal=@vp`);
	} else {
		await targetPool
			.request()
			.input('vp', sql.Int, valor)
			.input('user', sql.VarChar(50), user)
			.input('pass', sql.VarChar(255), pass)
			.query(`
        INSERT INTO dbo.imPassword (
          Apellido, Nombres, Password, NombreRed, FechaActual, MarcadeBaja, Legajo, ValorPersonal
        ) VALUES ('Administrador', 'Sistema', @pass, @user, 0, ' ', @vp, @vp)
      `);
	}

	const sectores = (await targetPool.request().query(`SELECT Valor FROM dbo.imSectores`)).recordset;
	for (const s of sectores) {
		const ex = await targetPool
			.request()
			.input('p', sql.Int, vp)
			.input('sec', sql.VarChar(4), s.Valor)
			.query(`SELECT 1 FROM dbo.imPersonalSectores WHERE IdPersonal=@p AND IdSector=@sec`);
		if (!ex.recordset.length) {
			await targetPool
				.request()
				.input('p', sql.Int, vp)
				.input('sec', sql.VarChar(4), s.Valor)
				.query(`INSERT INTO dbo.imPersonalSectores (IdPersonal, IdSector) VALUES (@p, @sec)`);
		}
	}

	await targetPool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol=1)
      INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
      VALUES (1, 'ADMIN', 'Administrador del sistema', 100, 1);
  `).catch(() => {});

	await targetPool.request().query(`
    IF OBJECT_ID('dbo.imPersonalEmpresas', 'U') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dbo.imPersonalEmpresas WHERE IdPersonal = ${vp})
    BEGIN
      INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa)
      SELECT ${vp}, COALESCE((SELECT TOP 1 IDEMPRESA FROM dbo.Empresas ORDER BY IDEMPRESA), 1);
    END
  `).catch(() => {});

	await log(targetPool, 'admin', 'INFO', `Usuario admin "${user}" listo (ValorPersonal=${vp}, ${sectores.length} sectores)`);
	return { user, valorPersonal: vp, sectores: sectores.length };
}

async function runPhase(name, sourcePool, targetPool, opts) {
	const runners = {
		schema: () => phaseSchema(targetPool, opts),
		catalogos: () => phaseCatalogos(sourcePool, targetPool, opts),
		sectores: () => phaseSectores(sourcePool, targetPool, opts),
		habitaciones: () => phaseHabitaciones(sourcePool, targetPool, opts),
		prestadores: () => phasePrestadores(sourcePool, targetPool, opts),
		pacientes: () => phasePacientes(sourcePool, targetPool, opts),
		internaciones: () => phaseInternaciones(sourcePool, targetPool, opts),
		admin: () => phaseAdmin(targetPool, opts),
	};
	if (!runners[name]) throw new Error(`Fase desconocida: ${name}`);
	return runners[name]();
}

async function main() {
	const opts = parseArgs(process.argv);
	if (!opts.targetDb) {
		console.error('Falta --target-db (BD iMedic limpia). Ver scripts/onboarding/README.md');
		process.exit(1);
	}
	if (!opts.sourceDb) {
		console.error('Falta --source-db (BD origen). Ver scripts/onboarding/README.md');
		process.exit(1);
	}

	console.log('Migración onboarding → iMedic');
	console.log(`  Origen:  ${opts.sourceDb}`);
	console.log(`  Destino: ${opts.targetDb}`);
	console.log(`  Modo:    ${opts.dryRun ? 'DRY-RUN' : 'EJECUCIÓN'}`);

	const sourcePool = await new sql.ConnectionPool(sqlConfig(opts.sourceDb)).connect();
	const targetPool = await new sql.ConnectionPool(sqlConfig(opts.targetDb)).connect();
	targetPool._dryRun = opts.dryRun;
	opts.sectorCatalog = await loadSectorCatalog(sourcePool);

	const toRun = opts.phase === 'all' ? PHASES : PHASES.includes(opts.phase) ? [opts.phase] : [opts.phase];
	const summary = {};

	for (const fase of toRun) {
		console.log(`\n── ${fase} ──`);
		try {
			summary[fase] = await runPhase(fase, sourcePool, targetPool, opts);
		} catch (err) {
			await log(targetPool, fase, 'ERROR', err.message, err.stack);
			throw err;
		}
	}

	console.log('\n=== Resumen ===');
	console.log(JSON.stringify(summary, null, 2));
	await sourcePool.close();
	await targetPool.close();
}

main().catch((e) => {
	console.error('Migración fallida:', e.message);
	process.exit(1);
});
