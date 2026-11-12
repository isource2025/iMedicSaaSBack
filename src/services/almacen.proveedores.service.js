/**
 * Proveedores Clarion: dbo.PROVEEDORES + Proveedores_Tel + PROVEEDORES_CONT
 * + Proveedores_Obs + Proveedores_Prod. Catálogos: Status_Prov, TIPOS_PROVEEDORES,
 * TIPOS_PROV_CATEG, Tipos_Iva, Paises, Provincias, Localidades, Bancos.
 *
 * IDPROVEEDOR no es IDENTITY: MAX + 1 con bloqueo. Un proveedor con remitos,
 * compras o cuenta corriente no se borra: pasa a IDSTATUS 3 (BAJA).
 */
const { executeQuery } = require('../models/db');
const { httpError, trim, num, pagina, audUserDe, ahoraCtx, enTransaccion, esErrorSql, sql } = require('./almacen.comun');

const STATUS = { ACTIVO: 1, SUSPENDIDO: 2, BAJA: 3 };

/** Dígito verificador de CUIT/CUIL (módulo 11). */
function cuitValido(cuit) {
	const s = String(cuit || '').replace(/\D/g, '');
	if (s.length !== 11) return false;
	const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
	const suma = pesos.reduce((acc, p, i) => acc + p * Number(s[i]), 0);
	let dv = 11 - (suma % 11);
	if (dv === 11) dv = 0;
	if (dv === 10) dv = 9;
	return dv === Number(s[10]);
}

function fmtCuit(n) {
	const s = String(n || '').replace(/\D/g, '');
	if (s.length !== 11 || /^0+$/.test(s)) return null;
	return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
}

function mapProveedor(r) {
	const cuit = r.NRO_CUIT != null && Number(r.NRO_CUIT) > 0 ? String(r.NRO_CUIT) : null;
	const domicilio = [trim(r.CALLE), r.CALLE_NRO ? String(r.CALLE_NRO) : null].filter(Boolean).join(' ');
	return {
		IdProveedor: r.IDPROVEEDOR,
		Descripcion: trim(r.DESCRIPCION) || `Proveedor ${r.IDPROVEEDOR}`,
		NombreFantasia: trim(r.NOMBRE_FANTASIA),
		FechaAlta: r.FECHA_ALTA || null,
		IdStatus: r.IDSTATUS,
		StatusNombre: trim(r.StatusNombre),
		IdTipoProv: r.IDTIPO_PROV,
		TipoNombre: trim(r.TipoNombre),
		IdTipoProvCateg: r.IDTIPO_PROV_CATEG,
		CategNombre: trim(r.CategNombre),
		Cuit: cuit,
		CuitFmt: fmtCuit(cuit),
		IdTipoIva: r.IDTIPOIVA,
		TipoIvaNombre: trim(r.TipoIvaNombre),
		Email: trim(r.EMAIL),
		Calle: trim(r.CALLE),
		CalleNro: r.CALLE_NRO || null,
		Piso: trim(r.PISO),
		Depto: trim(r.DEPTO),
		IdCodPostal: trim(r.IDCODPOSTAL),
		IdLocalidad: r.IDLOCALIDAD || null,
		LocalidadNombre: trim(r.LocalidadNombre),
		IdProvincia: r.IDPROVINCIA || null,
		ProvinciaNombre: trim(r.ProvinciaNombre),
		IdPais: r.IDPAIS || null,
		EntreCalles: trim(r.ENTRE_CALLES),
		ChequesOrden: trim(r.CHEQUES_ORDEN),
		IdBanco: r.IDBANCO ?? null,
		NroCuenta: trim(r.NROCUENTA),
		Descuento: r.DESCUENTO != null ? Number(r.DESCUENTO) : 0,
		Domicilio: [domicilio, trim(r.LocalidadNombre), trim(r.ProvinciaNombre)].filter(Boolean).join(', ') || null,
		Remitos: Number(r.Remitos || 0),
		UltimoRemito: r.UltimoRemito || null,
		ImporteRemitos: Number(r.ImporteRemitos || 0),
		Productos: Number(r.Productos || 0),
		Telefono: trim(r.Telefono),
	};
}

const SELECT_PROV = `
  pr.IDPROVEEDOR, pr.DESCRIPCION, pr.NOMBRE_FANTASIA, pr.FECHA_ALTA, pr.IDSTATUS, pr.IDTIPO_PROV,
  pr.IDTIPO_PROV_CATEG, pr.NRO_CUIT, pr.IDTIPOIVA, pr.EMAIL, pr.CALLE, pr.CALLE_NRO, pr.PISO, pr.DEPTO,
  pr.IDCODPOSTAL, pr.IDLOCALIDAD, pr.IDPROVINCIA, pr.IDPAIS, pr.ENTRE_CALLES, pr.CHEQUES_ORDEN,
  pr.IDBANCO, pr.NROCUENTA, pr.DESCUENTO,
  RTRIM(st.Descripcion) AS StatusNombre,
  RTRIM(tp.DESCRIPCION) AS TipoNombre,
  RTRIM(tc.DESCRIPCION) AS CategNombre,
  RTRIM(ti.Descripcion) AS TipoIvaNombre,
  RTRIM(lo.Descripcion) AS LocalidadNombre,
  RTRIM(pv.Descripcion) AS ProvinciaNombre,
  act.Remitos, act.UltimoRemito, act.ImporteRemitos,
  (SELECT COUNT(*) FROM dbo.Proveedores_Prod pp WHERE pp.IdProveedor = pr.IDPROVEEDOR) AS Productos,
  (SELECT TOP 1 RTRIM(t.NroTelefono) FROM dbo.Proveedores_Tel t WHERE t.IdProveedor = pr.IDPROVEEDOR) AS Telefono
`;

const FROM_PROV = `
  FROM dbo.PROVEEDORES pr
  LEFT JOIN dbo.Status_Prov st ON st.IdStatus = pr.IDSTATUS
  LEFT JOIN dbo.TIPOS_PROVEEDORES tp ON tp.IDTIPO_PROV = pr.IDTIPO_PROV
  LEFT JOIN dbo.TIPOS_PROV_CATEG tc ON tc.IDTIPO_PROV_CATEG = pr.IDTIPO_PROV_CATEG
  LEFT JOIN dbo.Tipos_Iva ti ON ti.IdTipoIva = pr.IDTIPOIVA
  LEFT JOIN dbo.Localidades lo ON lo.IdLocalidad = pr.IDLOCALIDAD AND pr.IDLOCALIDAD > 0
  LEFT JOIN dbo.Provincias pv ON pv.IdProvincia = pr.IDPROVINCIA AND pr.IDPROVINCIA > 0
  OUTER APPLY (
    SELECT COUNT(*) AS Remitos, MAX(r.Fecha) AS UltimoRemito, SUM(ISNULL(r.ImportePPP, 0)) AS ImporteRemitos
    FROM dbo.Remitos r WHERE r.IdProveedor = pr.IDPROVEEDOR AND r.IdStatus <> 0
  ) act
`;

function filtros({ search, estado, idTipo }) {
	const where = ['1=1'];
	const params = [];
	const q = trim(search);
	if (q) {
		const i = params.length;
		where.push(`(
      CAST(pr.IDPROVEEDOR AS varchar(20)) LIKE @p${i}
      OR pr.DESCRIPCION LIKE @p${i}
      OR pr.NOMBRE_FANTASIA LIKE @p${i}
      OR CAST(pr.NRO_CUIT AS varchar(30)) LIKE @p${i}
      OR pr.EMAIL LIKE @p${i}
    )`);
		params.push({ value: `%${q.replace(/-/g, '')}%`, type: 'NVarChar', length: 120 });
	}
	const est = num(estado);
	if (est != null) {
		where.push(`ISNULL(pr.IDSTATUS, 1) = @p${params.length}`);
		params.push({ value: est, type: 'SmallInt' });
	}
	const tipo = num(idTipo);
	if (tipo != null) {
		where.push(`pr.IDTIPO_PROV = @p${params.length}`);
		params.push({ value: tipo, type: 'SmallInt' });
	}
	return { whereSql: where.join(' AND '), params };
}

const ORDENES = {
	nombre: 'RTRIM(pr.DESCRIPCION), pr.IDPROVEEDOR',
	reciente: 'pr.FECHA_ALTA DESC, pr.IDPROVEEDOR DESC',
	actividad: 'act.Remitos DESC, RTRIM(pr.DESCRIPCION)',
	codigo: 'pr.IDPROVEEDOR',
};

async function listar(opts = {}) {
	const { page, pageSize, offset } = pagina(opts.page, opts.pageSize);
	const { whereSql, params } = filtros(opts);
	const orden = ORDENES[opts.orden] || ORDENES.nombre;
	const countRows = await executeQuery(`SELECT COUNT(*) AS Total FROM dbo.PROVEEDORES pr WHERE ${whereSql}`, params);
	const total = Number(countRows?.[0]?.Total || 0);
	const rows = await executeQuery(
		`
    SELECT ${SELECT_PROV}
    ${FROM_PROV}
    WHERE ${whereSql}
    ORDER BY ${orden}
    OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
    `,
		[...params, { value: offset, type: 'Int' }, { value: pageSize, type: 'Int' }],
	);
	return {
		items: rows.map(mapProveedor),
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize)),
	};
}

async function resumen() {
	const [tot, porTipo, top] = await Promise.all([
		executeQuery(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN ISNULL(IDSTATUS, 1) = ${STATUS.ACTIVO} THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN IDSTATUS = ${STATUS.SUSPENDIDO} THEN 1 ELSE 0 END) AS suspendidos,
        SUM(CASE WHEN IDSTATUS = ${STATUS.BAJA} THEN 1 ELSE 0 END) AS bajas,
        SUM(CASE WHEN NRO_CUIT > 0 THEN 1 ELSE 0 END) AS conCuit,
        SUM(CASE WHEN LEN(RTRIM(ISNULL(EMAIL, ''))) > 0 THEN 1 ELSE 0 END) AS conEmail,
        SUM(CASE WHEN LEN(RTRIM(ISNULL(CALLE, ''))) > 0 THEN 1 ELSE 0 END) AS conDomicilio,
        SUM(CASE WHEN FECHA_ALTA >= DATEADD(day, -90, GETDATE()) THEN 1 ELSE 0 END) AS nuevos90,
        (SELECT COUNT(DISTINCT IdProveedor) FROM dbo.Remitos WHERE IdProveedor > 0 AND IdStatus <> 0) AS conRemitos
      FROM dbo.PROVEEDORES
    `),
		executeQuery(`
      SELECT pr.IDTIPO_PROV AS IdTipoProv, RTRIM(MAX(tp.DESCRIPCION)) AS Descripcion, COUNT(*) AS cantidad
      FROM dbo.PROVEEDORES pr
      LEFT JOIN dbo.TIPOS_PROVEEDORES tp ON tp.IDTIPO_PROV = pr.IDTIPO_PROV
      GROUP BY pr.IDTIPO_PROV
      ORDER BY COUNT(*) DESC
    `),
		executeQuery(`
      SELECT TOP 5 r.IdProveedor, RTRIM(MAX(pr.DESCRIPCION)) AS Descripcion,
        COUNT(*) AS remitos, SUM(ISNULL(r.ImportePPP, 0)) AS importe, MAX(r.Fecha) AS ultimo
      FROM dbo.Remitos r
      JOIN dbo.PROVEEDORES pr ON pr.IDPROVEEDOR = r.IdProveedor
      WHERE r.IdProveedor > 0 AND r.IdStatus <> 0
      GROUP BY r.IdProveedor
      ORDER BY COUNT(*) DESC
    `),
	]);
	const t = tot[0] || {};
	const n = (v) => Number(v || 0);
	const total = n(t.total);
	const pct = (v) => (total ? Math.round((n(v) / total) * 100) : 0);
	return {
		total,
		activos: n(t.activos),
		suspendidos: n(t.suspendidos),
		bajas: n(t.bajas),
		conCuit: n(t.conCuit),
		conEmail: n(t.conEmail),
		conDomicilio: n(t.conDomicilio),
		conRemitos: n(t.conRemitos),
		nuevos90: n(t.nuevos90),
		pctActivos: pct(t.activos),
		pctConCuit: pct(t.conCuit),
		pctConEmail: pct(t.conEmail),
		pctConDomicilio: pct(t.conDomicilio),
		porTipo: porTipo.map((x) => ({
			IdTipoProv: x.IdTipoProv,
			Descripcion: trim(x.Descripcion) || 'Sin tipo',
			cantidad: n(x.cantidad),
		})),
		top: top.map((x) => ({
			IdProveedor: x.IdProveedor,
			Descripcion: trim(x.Descripcion),
			remitos: n(x.remitos),
			importe: n(x.importe),
			ultimo: x.ultimo,
		})),
	};
}

async function catalogos() {
	const q = (s) => executeQuery(s).catch(() => []);
	const [estados, tipos, categorias, tiposIva, paises, provincias, localidades, bancos, next] = await Promise.all([
		q(`SELECT IdStatus, RTRIM(Descripcion) AS Descripcion FROM dbo.Status_Prov ORDER BY IdStatus`),
		q(`SELECT IDTIPO_PROV AS IdTipoProv, RTRIM(DESCRIPCION) AS Descripcion FROM dbo.TIPOS_PROVEEDORES ORDER BY DESCRIPCION`),
		q(`SELECT IDTIPO_PROV_CATEG AS IdTipoProvCateg, RTRIM(DESCRIPCION) AS Descripcion FROM dbo.TIPOS_PROV_CATEG ORDER BY DESCRIPCION`),
		q(`SELECT IdTipoIva, RTRIM(Descripcion) AS Descripcion, RTRIM(TipoIva) AS TipoIva FROM dbo.Tipos_Iva ORDER BY IdTipoIva`),
		q(`SELECT IdPais, RTRIM(Descripcion) AS Descripcion FROM dbo.Paises ORDER BY Descripcion`),
		q(`SELECT IdProvincia, RTRIM(Descripcion) AS Descripcion, IdPais FROM dbo.Provincias ORDER BY Descripcion`),
		q(`SELECT IdLocalidad, RTRIM(Descripcion) AS Descripcion, IdProvincia FROM dbo.Localidades WHERE IdLocalidad > 0 ORDER BY Descripcion`),
		q(`SELECT IdBanco, RTRIM(Descripcion) AS Descripcion FROM dbo.Bancos ORDER BY Descripcion`),
		q(`SELECT ISNULL(MAX(IDPROVEEDOR), 0) + 1 AS n FROM dbo.PROVEEDORES`),
	]);
	const limpio = (rows) => rows.filter((r) => trim(r.Descripcion));
	return {
		estados: limpio(estados),
		tipos: limpio(tipos),
		categorias: limpio(categorias),
		tiposIva: limpio(tiposIva),
		paises: limpio(paises),
		provincias: limpio(provincias),
		localidades: limpio(localidades),
		bancos: limpio(bancos),
		nextId: next[0]?.n || 1,
	};
}

async function obtener(id) {
	const idNum = num(id);
	if (!idNum) throw httpError('Proveedor inválido');
	const p = [{ value: idNum, type: 'Int' }];
	const [rows, tels, conts, obs, prods, remitos] = await Promise.all([
		executeQuery(`SELECT ${SELECT_PROV} ${FROM_PROV} WHERE pr.IDPROVEEDOR = @p0`, p),
		executeQuery(
			`SELECT RTRIM(TipoTelefono) AS Tipo, RTRIM(NroTelefono) AS Numero, RTRIM(Observaciones) AS Observaciones
       FROM dbo.Proveedores_Tel WHERE IdProveedor = @p0 ORDER BY NroTelefono`,
			p,
		),
		executeQuery(
			`SELECT NRORENGLON AS Renglon, RTRIM(CONTACTO) AS Contacto, RTRIM(CARGO) AS Cargo,
              RTRIM(NROINTERNO) AS Interno, RTRIM(EMAIL) AS Email, COMENTARIOS AS Comentarios
       FROM dbo.PROVEEDORES_CONT WHERE IDPROVEEDOR = @p0 ORDER BY NRORENGLON`,
			p,
		),
		executeQuery(
			`SELECT Fecha, Nro_Observa AS Nro, Comentarios FROM dbo.Proveedores_Obs
       WHERE IdProveedor = @p0 ORDER BY Fecha DESC, Nro_Observa DESC`,
			p,
		),
		executeQuery(
			`SELECT pp.IdRegistro, pp.IdProducto, RTRIM(pp.Cod_Proveedor) AS CodProveedor, RTRIM(pp.Desc_Prove) AS DescProveedor,
              pp.Precio_Ref AS PrecioRef, pp.Fecha_Ref AS FechaRef, pp.Plazo_Entrega AS PlazoEntrega,
              COALESCE(NULLIF(RTRIM(pr.Descripcion), ''), RTRIM(pr.DescripcionC)) AS ProductoNombre,
              RTRIM(pr.IdUnidad) AS IdUnidad
       FROM dbo.Proveedores_Prod pp
       LEFT JOIN dbo.Productos pr ON pr.IdProducto = pp.IdProducto
       WHERE pp.IdProveedor = @p0 ORDER BY ProductoNombre`,
			p,
		),
		executeQuery(
			`SELECT TOP 8 r.IdTransaccion, RTRIM(r.Tipo_Cbte) AS Tipo, r.Grupo_Cbte AS Grupo, r.NroCbte AS Nro,
              r.Fecha, r.ImportePPP AS Importe, r.IdStatus, RTRIM(d.Descripcion) AS DepositoNombre
       FROM dbo.Remitos r
       LEFT JOIN dbo.Depositos d ON d.IdDeposito = r.IdDeposito
       WHERE r.IdProveedor = @p0
       ORDER BY r.Fecha DESC, r.IdTransaccion DESC`,
			p,
		),
	]);
	if (!rows.length) throw httpError('Proveedor no encontrado', 404);
	return {
		...mapProveedor(rows[0]),
		telefonos: tels.map((t) => ({ Tipo: trim(t.Tipo), Numero: trim(t.Numero), Observaciones: trim(t.Observaciones) })),
		contactos: conts.map((c) => ({
			Contacto: trim(c.Contacto),
			Cargo: trim(c.Cargo),
			Interno: trim(c.Interno),
			Email: trim(c.Email),
			Comentarios: trim(c.Comentarios),
		})),
		observaciones: obs.map((o) => ({ Fecha: o.Fecha, Nro: o.Nro, Comentarios: trim(o.Comentarios) })),
		productos: prods.map((x) => ({
			IdRegistro: x.IdRegistro,
			IdProducto: x.IdProducto,
			ProductoNombre: trim(x.ProductoNombre) || `Producto ${x.IdProducto}`,
			IdUnidad: trim(x.IdUnidad),
			CodProveedor: trim(x.CodProveedor),
			DescProveedor: trim(x.DescProveedor),
			PrecioRef: x.PrecioRef != null ? Number(x.PrecioRef) : null,
			FechaRef: x.FechaRef,
			PlazoEntrega: x.PlazoEntrega,
		})),
		ultimosRemitos: remitos.map((r) => ({
			IdTransaccion: r.IdTransaccion,
			Comprobante: `${r.Tipo} ${r.Grupo}-${String(r.Nro).padStart(6, '0')}`,
			Fecha: r.Fecha,
			Importe: Number(r.Importe || 0),
			IdStatus: r.IdStatus,
			DepositoNombre: trim(r.DepositoNombre),
		})),
	};
}

function payload(body) {
	const desc = trim(body.Descripcion);
	if (!desc) throw httpError('La razón social es obligatoria');
	const cuitRaw = String(body.Cuit ?? '').replace(/\D/g, '');
	if (cuitRaw && !cuitValido(cuitRaw)) throw httpError('El CUIT no es válido (revisá el dígito verificador)');
	const email = trim(body.Email);
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('El email no es válido');
	const calleNro = num(body.CalleNro);
	if (calleNro != null && (calleNro < 0 || calleNro > 32767)) throw httpError('La altura de la calle no es válida');
	const descuento = num(body.Descuento) ?? 0;
	if (descuento < 0 || descuento > 100) throw httpError('El descuento debe estar entre 0 y 100');
	const estado = num(body.IdStatus) ?? STATUS.ACTIVO;
	return {
		desc: desc.slice(0, 70),
		fantasia: (trim(body.NombreFantasia) || '').slice(0, 40) || null,
		estado,
		tipo: num(body.IdTipoProv) ?? 1,
		categ: num(body.IdTipoProvCateg),
		cuit: cuitRaw ? Number(cuitRaw) : 0,
		iva: num(body.IdTipoIva),
		email: (email || '').slice(0, 100),
		calle: (trim(body.Calle) || '').slice(0, 50),
		calleNro: calleNro ?? 0,
		piso: (trim(body.Piso) || '').slice(0, 3),
		depto: (trim(body.Depto) || '').slice(0, 4),
		cp: (trim(body.IdCodPostal) || '').slice(0, 8),
		localidad: num(body.IdLocalidad) ?? 0,
		provincia: num(body.IdProvincia) ?? 0,
		pais: num(body.IdPais) ?? 0,
		entre: (trim(body.EntreCalles) || '').slice(0, 40),
		cheques: (trim(body.ChequesOrden) || '').slice(0, 80),
		banco: num(body.IdBanco),
		cuenta: (trim(body.NroCuenta) || '').slice(0, 20) || null,
		descuento,
	};
}

function inputsPayload(r, p, extra) {
	return r
		.input('id', sql.Int, extra.id)
		.input('desc', sql.VarChar(70), p.desc)
		.input('fantasia', sql.VarChar(40), p.fantasia)
		.input('estado', sql.SmallInt, p.estado)
		.input('tipo', sql.SmallInt, p.tipo)
		.input('categ', sql.SmallInt, p.categ)
		.input('cuit', sql.Numeric(15, 0), p.cuit)
		.input('iva', sql.SmallInt, p.iva)
		.input('email', sql.VarChar(100), p.email)
		.input('calle', sql.VarChar(50), p.calle)
		.input('calleNro', sql.SmallInt, p.calleNro)
		.input('piso', sql.VarChar(3), p.piso)
		.input('depto', sql.VarChar(4), p.depto)
		.input('cp', sql.VarChar(8), p.cp)
		.input('loc', sql.Int, p.localidad)
		.input('prov', sql.SmallInt, p.provincia)
		.input('pais', sql.SmallInt, p.pais)
		.input('entre', sql.VarChar(40), p.entre)
		.input('cheques', sql.VarChar(80), p.cheques)
		.input('banco', sql.SmallInt, p.banco)
		.input('cuenta', sql.VarChar(20), p.cuenta)
		.input('descuento', sql.Numeric(5, 2), p.descuento)
		.input('ahora', sql.DateTime, extra.ahora)
		.input('audUser', sql.SmallInt, extra.audUser);
}

async function validarCuitUnico(tx, cuit, idExcluir) {
	if (!cuit) return;
	const r = await new sql.Request(tx)
		.input('cuit', sql.Numeric(15, 0), cuit)
		.input('id', sql.Int, idExcluir || 0)
		.query(`SELECT TOP 1 IDPROVEEDOR, RTRIM(DESCRIPCION) AS D FROM dbo.PROVEEDORES
            WHERE NRO_CUIT = @cuit AND IDPROVEEDOR <> @id AND ISNULL(IDSTATUS, 1) <> ${STATUS.BAJA}`);
	const dup = r.recordset[0];
	if (dup) throw httpError(`Ya existe el proveedor #${dup.IDPROVEEDOR} (${trim(dup.D)}) con ese CUIT`, 409);
}

/** Reemplaza teléfonos, contactos y productos asociados si vienen en el body. */
async function escribirHijos(tx, id, body, { ahora, fecha }) {
	if (Array.isArray(body.telefonos)) {
		await new sql.Request(tx).input('id', sql.Int, id).query(`DELETE FROM dbo.Proveedores_Tel WHERE IdProveedor = @id`);
		const vistos = new Set();
		for (const t of body.telefonos) {
			const numero = (trim(t.Numero) || '').slice(0, 17);
			if (!numero || vistos.has(numero)) continue;
			vistos.add(numero);
			await new sql.Request(tx)
				.input('id', sql.Int, id)
				.input('tipo', sql.VarChar(1), (trim(t.Tipo) || 'T').slice(0, 1))
				.input('nro', sql.VarChar(17), numero)
				.input('obs', sql.VarChar(75), (trim(t.Observaciones) || '').slice(0, 75))
				.query(`INSERT INTO dbo.Proveedores_Tel (IdProveedor, TipoTelefono, NroTelefono, Observaciones) VALUES (@id, @tipo, @nro, @obs)`);
		}
	}
	if (Array.isArray(body.contactos)) {
		await new sql.Request(tx).input('id', sql.Int, id).query(`DELETE FROM dbo.PROVEEDORES_CONT WHERE IDPROVEEDOR = @id`);
		let ren = 0;
		for (const c of body.contactos) {
			const nombre = (trim(c.Contacto) || '').slice(0, 30);
			if (!nombre) continue;
			ren++;
			await new sql.Request(tx)
				.input('id', sql.Int, id)
				.input('ren', sql.SmallInt, ren)
				.input('nombre', sql.VarChar(30), nombre)
				.input('cargo', sql.VarChar(30), (trim(c.Cargo) || '').slice(0, 30))
				.input('interno', sql.VarChar(10), (trim(c.Interno) || '').slice(0, 10))
				.input('email', sql.VarChar(60), (trim(c.Email) || '').slice(0, 60))
				.input('com', sql.VarChar(4000), (trim(c.Comentarios) || '').slice(0, 4000))
				.query(`INSERT INTO dbo.PROVEEDORES_CONT (IDPROVEEDOR, NRORENGLON, CONTACTO, CARGO, NROINTERNO, EMAIL, COMENTARIOS)
                VALUES (@id, @ren, @nombre, @cargo, @interno, @email, @com)`);
		}
	}
	if (Array.isArray(body.productos)) {
		await new sql.Request(tx).input('id', sql.Int, id).query(`DELETE FROM dbo.Proveedores_Prod WHERE IdProveedor = @id`);
		const vistos = new Set();
		for (const x of body.productos) {
			const idProd = num(x.IdProducto);
			if (!idProd || vistos.has(idProd)) continue;
			vistos.add(idProd);
			const precio = num(x.PrecioRef);
			await new sql.Request(tx)
				.input('id', sql.Int, id)
				.input('prod', sql.Int, idProd)
				.input('cod', sql.VarChar(20), (trim(x.CodProveedor) || '').slice(0, 20))
				.input('desc', sql.VarChar(80), (trim(x.DescProveedor) || '').slice(0, 80) || null)
				.input('precio', sql.Decimal(13, 4), precio)
				.input('fecha', sql.DateTime, precio != null ? fecha : null)
				.input('plazo', sql.SmallInt, num(x.PlazoEntrega))
				.query(`
          INSERT INTO dbo.Proveedores_Prod (
            IdProveedor, Nivel, IdRubro, IdSubRubro, IdLinea, IdProducto, Cod_Proveedor, Desc_Prove,
            Precio_Ref, Fecha_Ref, Plazo_Entrega, Es_Automatico
          )
          SELECT @id, 'P', ISNULL(p.IdRubro, 0), ISNULL(p.IdSubRubro, 0), ISNULL(p.IdLinea, 0), @prod, @cod, @desc,
                 @precio, @fecha, @plazo, 0
          FROM dbo.Productos p WHERE p.IdProducto = @prod
        `);
		}
	}
	const nuevaObs = trim(body.NuevaObservacion);
	if (nuevaObs) {
		await new sql.Request(tx)
			.input('id', sql.Int, id)
			.input('fecha', sql.DateTime, ahora)
			.input('com', sql.VarChar(2000), nuevaObs.slice(0, 2000))
			.query(`
        INSERT INTO dbo.Proveedores_Obs (IdProveedor, Fecha, Nro_Observa, IdTipo_Prov_Obs, Comentarios)
        SELECT @id, @fecha, ISNULL(MAX(Nro_Observa), 0) + 1, 0, @com
        FROM dbo.Proveedores_Obs WITH (UPDLOCK, HOLDLOCK) WHERE IdProveedor = @id AND Fecha = @fecha
      `);
	}
}

async function crear(body, auth) {
	const p = payload(body);
	const { ahora, fecha } = ahoraCtx();
	const audUser = audUserDe(auth);
	const id = await enTransaccion(async (tx) => {
		await validarCuitUnico(tx, p.cuit, 0);
		const r = await new sql.Request(tx).query(
			`SELECT ISNULL(MAX(IDPROVEEDOR), 0) + 1 AS n FROM dbo.PROVEEDORES WITH (UPDLOCK, HOLDLOCK)`,
		);
		const nuevo = r.recordset[0].n;
		await inputsPayload(new sql.Request(tx), p, { id: nuevo, ahora, audUser })
			.input('alta', sql.DateTime, fecha)
			.query(`
        INSERT INTO dbo.PROVEEDORES (
          IDPROVEEDOR, DESCRIPCION, NOMBRE_FANTASIA, FECHA_ALTA, IDSTATUS, IDTIPO_PROV, IDTIPO_PROV_CATEG,
          NRO_CUIT, IDTIPOIVA, es_fiscal, EMAIL, CALLE, CALLE_NRO, PISO, DEPTO, IDCODPOSTAL, IDLOCALIDAD,
          IDPROVINCIA, IDPAIS, ENTRE_CALLES, CHEQUES_ORDEN, IDBANCO, NROCUENTA, DESCUENTO, Codigo_Ganancias,
          Porc_Excepcion, IdCondCpra, AUD_FECHA, AUD_USUARIO, AUD_ACCION
        ) VALUES (
          @id, @desc, @fantasia, @alta, @estado, @tipo, @categ,
          @cuit, @iva, CASE WHEN @cuit > 0 THEN 1 ELSE 0 END, @email, @calle, @calleNro, @piso, @depto, @cp, @loc,
          @prov, @pais, @entre, @cheques, @banco, @cuenta, @descuento, 0,
          0, 1, @ahora, @audUser, 1
        )
      `);
		await escribirHijos(tx, nuevo, body, { ahora, fecha });
		return nuevo;
	});
	return obtener(id);
}

async function actualizar(id, body, auth) {
	const idNum = num(id);
	if (!idNum) throw httpError('Proveedor inválido');
	const p = payload(body);
	const { ahora, fecha } = ahoraCtx();
	const audUser = audUserDe(auth);
	await enTransaccion(async (tx) => {
		const ex = await new sql.Request(tx)
			.input('id', sql.Int, idNum)
			.query(`SELECT IDPROVEEDOR FROM dbo.PROVEEDORES WITH (UPDLOCK, HOLDLOCK) WHERE IDPROVEEDOR = @id`);
		if (!ex.recordset.length) throw httpError('Proveedor no encontrado', 404);
		await validarCuitUnico(tx, p.cuit, idNum);
		await inputsPayload(new sql.Request(tx), p, { id: idNum, ahora, audUser }).query(`
      UPDATE dbo.PROVEEDORES SET
        DESCRIPCION = @desc, NOMBRE_FANTASIA = @fantasia, IDSTATUS = @estado, IDTIPO_PROV = @tipo,
        IDTIPO_PROV_CATEG = @categ, NRO_CUIT = @cuit, IDTIPOIVA = @iva,
        es_fiscal = CASE WHEN @cuit > 0 THEN 1 ELSE es_fiscal END,
        EMAIL = @email, CALLE = @calle, CALLE_NRO = @calleNro, PISO = @piso, DEPTO = @depto,
        IDCODPOSTAL = @cp, IDLOCALIDAD = @loc, IDPROVINCIA = @prov, IDPAIS = @pais, ENTRE_CALLES = @entre,
        CHEQUES_ORDEN = @cheques, IDBANCO = @banco, NROCUENTA = @cuenta, DESCUENTO = @descuento,
        AUD_FECHA = @ahora, AUD_USUARIO = @audUser, AUD_ACCION = 2
      WHERE IDPROVEEDOR = @id
    `);
		await escribirHijos(tx, idNum, body, { ahora, fecha });
	});
	return obtener(idNum);
}

async function cambiarEstado(id, estado, auth) {
	const idNum = num(id);
	const est = num(estado);
	if (!idNum) throw httpError('Proveedor inválido');
	if (![STATUS.ACTIVO, STATUS.SUSPENDIDO, STATUS.BAJA].includes(est)) throw httpError('Estado inválido');
	const { ahora } = ahoraCtx();
	const r = await executeQuery(
		`UPDATE dbo.PROVEEDORES SET IDSTATUS = @p1, AUD_FECHA = @p2, AUD_USUARIO = @p3, AUD_ACCION = 2
     WHERE IDPROVEEDOR = @p0; SELECT @@ROWCOUNT AS n;`,
		[
			{ value: idNum, type: 'Int' },
			{ value: est, type: 'SmallInt' },
			{ value: ahora, type: 'DateTime' },
			{ value: audUserDe(auth), type: 'SmallInt' },
		],
	);
	if (!r[0]?.n) throw httpError('Proveedor no encontrado', 404);
	return obtener(idNum);
}

/**
 * Borra el proveedor y sus tablas hijas si no tiene movimientos.
 * Con remitos, compras o cuenta corriente lo da de baja (IDSTATUS 3).
 */
async function eliminar(id, auth) {
	const idNum = num(id);
	if (!idNum) throw httpError('Proveedor inválido');
	const uso = await executeQuery(
		`SELECT
       (SELECT COUNT(*) FROM dbo.Remitos WHERE IdProveedor = @p0) AS remitos,
       (SELECT COUNT(*) FROM dbo.Compras WHERE IdProveedor = @p0) AS compras,
       (SELECT COUNT(*) FROM dbo.CtaCte_Prov WHERE IdProveedor = @p0) AS ctacte`,
		[{ value: idNum, type: 'Int' }],
	).catch(() => [{ remitos: 1 }]);
	const u = uso[0] || {};
	if (Number(u.remitos) || Number(u.compras) || Number(u.ctacte)) {
		const data = await cambiarEstado(idNum, STATUS.BAJA, auth);
		return { modo: 'baja', proveedor: data };
	}
	try {
		await enTransaccion(async (tx) => {
			const r = new sql.Request(tx).input('id', sql.Int, idNum);
			const out = await r.query(`
        DELETE FROM dbo.Proveedores_Tel WHERE IdProveedor = @id;
        DELETE FROM dbo.PROVEEDORES_CONT WHERE IDPROVEEDOR = @id;
        DELETE FROM dbo.Proveedores_Obs WHERE IdProveedor = @id;
        DELETE FROM dbo.Proveedores_Prod WHERE IdProveedor = @id;
        DELETE FROM dbo.Proveedores_Dir WHERE IdProveedor = @id;
        DELETE FROM dbo.PROVEEDORES WHERE IDPROVEEDOR = @id;
        SELECT @@ROWCOUNT AS n;
      `);
			if (!out.recordset[0]?.n) throw httpError('Proveedor no encontrado', 404);
		});
	} catch (e) {
		if (!esErrorSql(e, 547)) throw e;
		const data = await cambiarEstado(idNum, STATUS.BAJA, auth);
		return { modo: 'baja', proveedor: data };
	}
	return { modo: 'eliminado' };
}

/** Búsqueda liviana para selects (remitos, productos). */
async function buscar({ search = '', limit = 30, soloActivos = true } = {}) {
	const params = [{ value: Math.min(80, Math.max(1, Number(limit) || 30)), type: 'Int' }];
	const where = [];
	if (soloActivos) where.push(`ISNULL(IDSTATUS, 1) <> ${STATUS.BAJA}`);
	const q = trim(search);
	if (q) {
		where.push(`(DESCRIPCION LIKE @p1 OR NOMBRE_FANTASIA LIKE @p1 OR CAST(IDPROVEEDOR AS varchar(20)) LIKE @p1)`);
		params.push({ value: `%${q}%`, type: 'NVarChar', length: 120 });
	}
	const rows = await executeQuery(
		`SELECT TOP (@p0) IDPROVEEDOR AS IdProveedor, RTRIM(DESCRIPCION) AS Descripcion
     FROM dbo.PROVEEDORES ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY RTRIM(DESCRIPCION)`,
		params,
	);
	return rows.map((r) => ({ IdProveedor: r.IdProveedor, Descripcion: trim(r.Descripcion) }));
}

/** Proveedores que tienen asignado el producto (ficha de producto). */
async function porProducto(idProducto) {
	const rows = await executeQuery(
		`SELECT pp.IdProveedor, RTRIM(pr.DESCRIPCION) AS Descripcion, RTRIM(pp.Cod_Proveedor) AS CodProveedor,
            pp.Precio_Ref AS PrecioRef, pp.Fecha_Ref AS FechaRef, pp.Plazo_Entrega AS PlazoEntrega, pr.IDSTATUS AS IdStatus
     FROM dbo.Proveedores_Prod pp
     JOIN dbo.PROVEEDORES pr ON pr.IDPROVEEDOR = pp.IdProveedor
     WHERE pp.IdProducto = @p0
     ORDER BY pp.Precio_Ref, RTRIM(pr.DESCRIPCION)`,
		[{ value: Number(idProducto), type: 'Int' }],
	);
	return rows.map((r) => ({
		IdProveedor: r.IdProveedor,
		Descripcion: trim(r.Descripcion),
		CodProveedor: trim(r.CodProveedor),
		PrecioRef: r.PrecioRef != null ? Number(r.PrecioRef) : null,
		FechaRef: r.FechaRef,
		PlazoEntrega: r.PlazoEntrega,
		IdStatus: r.IdStatus,
	}));
}

module.exports = {
	STATUS,
	cuitValido,
	listar,
	resumen,
	catalogos,
	obtener,
	crear,
	actualizar,
	cambiarEstado,
	eliminar,
	buscar,
	porProducto,
};
