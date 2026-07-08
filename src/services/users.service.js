const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const { convertirFechaAClarion } = require('../utils/dateUtils');
const authCentralSync = require('./authCentralSync.service');

/** Cache de esquema imPassword por tenant (evita mezclar metadatos entre BDs). */
const schemaCacheByTenant = new Map();

function tenantCacheKey() {
  const id = getTenantId();
  return id != null && Number.isFinite(Number(id)) && Number(id) > 0 ? String(id) : 'platform';
}

function getTenantSchemaCache() {
  const key = tenantCacheKey();
  if (!schemaCacheByTenant.has(key)) {
    schemaCacheByTenant.set(key, {
      fechaActualTipo: null,
      valorPersonalIsIdentity: null,
      codOperadorIsIdentity: null,
    });
  }
  return schemaCacheByTenant.get(key);
}

async function afterUserMutation(valorPersonal) {
  const idEmpresa = getTenantId();
  if (idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0) {
    await authCentralSync.syncUserLoginBundle(Number(idEmpresa), valorPersonal);
    return;
  }
  await authCentralSync.syncPassword(0, valorPersonal);
  await authCentralSync.syncPersonalSectores(0, valorPersonal);
}

/**
 * imPassword.FechaActual es int (días Clarion) en muchas bases legacy; en otras es datetime.
 */
async function getImPasswordFechaActualTipo() {
  const cache = getTenantSchemaCache();
  if (cache.fechaActualTipo) return cache.fechaActualTipo;
  try {
    const rows = await executeQuery(`
      SELECT DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE UPPER(TABLE_NAME) = 'IMPASSWORD' AND UPPER(COLUMN_NAME) = 'FECHAACTUAL'
    `);
    const t = (rows[0]?.DATA_TYPE || 'datetime').toLowerCase();
    cache.fechaActualTipo = ['int', 'smallint', 'bigint', 'tinyint'].includes(t) ? 'int' : t;
  } catch {
    cache.fechaActualTipo = 'datetime';
  }
  return cache.fechaActualTipo;
}

function readFirstIntCell(row) {
  if (!row || typeof row !== 'object') return null;
  const v = row.IsId ?? row.isId ?? row.isid ?? Object.values(row)[0];
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * En algunas bases ValorPersonal es IDENTITY; en otras se asigna con MAX+1.
 * COLUMNPROPERTY suele funcionar aunque sys.identity_columns no devuelva filas (sinónimos, permisos).
 */
async function getImPasswordValorPersonalIsIdentity() {
  const cache = getTenantSchemaCache();
  if (cache.valorPersonalIsIdentity !== null) return cache.valorPersonalIsIdentity;
  try {
    let rows = await executeQuery(`
      SELECT TOP 1 COLUMNPROPERTY(t.object_id, N'ValorPersonal', N'IsIdentity') AS IsId
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE LOWER(t.name) = N'impassword'
      ORDER BY CASE WHEN s.name = N'dbo' THEN 0 ELSE 1 END
    `);
    let id = readFirstIntCell(rows[0]);
    if (id === 1) {
      cache.valorPersonalIsIdentity = true;
      return true;
    }
    if (id === 0) {
      cache.valorPersonalIsIdentity = false;
      return false;
    }
    rows = await executeQuery(`
      SELECT TOP 1 COLUMNPROPERTY(OBJECT_ID(sn.base_object_name), N'ValorPersonal', N'IsIdentity') AS IsId
      FROM sys.synonyms sn
      INNER JOIN sys.schemas s ON sn.schema_id = s.schema_id
      WHERE LOWER(sn.name) = N'impassword'
      ORDER BY CASE WHEN s.name = N'dbo' THEN 0 ELSE 1 END
    `);
    id = readFirstIntCell(rows[0]);
    if (id === 1) {
      cache.valorPersonalIsIdentity = true;
      return true;
    }
  } catch {
    /* seguir */
  }
  cache.valorPersonalIsIdentity = false;
  return false;
}

async function getImPasswordCodOperadorIsIdentity() {
  const cache = getTenantSchemaCache();
  if (cache.codOperadorIsIdentity !== null) return cache.codOperadorIsIdentity;
  try {
    let rows = await executeQuery(`
      SELECT TOP 1 COLUMNPROPERTY(t.object_id, N'CodOperador', N'IsIdentity') AS IsId
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE LOWER(t.name) = N'impassword'
      ORDER BY CASE WHEN s.name = N'dbo' THEN 0 ELSE 1 END
    `);
    let id = readFirstIntCell(rows[0]);
    if (id === 1) {
      cache.codOperadorIsIdentity = true;
      return true;
    }
    if (id === 0) {
      cache.codOperadorIsIdentity = false;
      return false;
    }
    rows = await executeQuery(`
      SELECT TOP 1 COLUMNPROPERTY(OBJECT_ID(sn.base_object_name), N'CodOperador', N'IsIdentity') AS IsId
      FROM sys.synonyms sn
      INNER JOIN sys.schemas s ON sn.schema_id = s.schema_id
      WHERE LOWER(sn.name) = N'impassword'
      ORDER BY CASE WHEN s.name = N'dbo' THEN 0 ELSE 1 END
    `);
    id = readFirstIntCell(rows[0]);
    if (id === 1) {
      cache.codOperadorIsIdentity = true;
      return true;
    }
  } catch {
    /* seguir */
  }
  cache.codOperadorIsIdentity = false;
  return false;
}

function isSqlIdentityInsertError(err) {
  const n = err?.number ?? err?.originalError?.info?.number;
  return n === 544;
}

/**
 * Violación de índice / clave única al INSERT (SQL Server 2601, 2627).
 * @returns {{ statusCode: number, message: string } | null}
 */
function mapDuplicateKeyErrorToHttp(err) {
  const n = err?.number ?? err?.originalError?.info?.number;
  if (n !== 2601 && n !== 2627) return null;
  const msg = String(err?.message || err?.originalError?.info?.message || '');
  const mIdx =
    msg.match(/unique index '([^']+)'/i) ||
    msg.match(/UNIQUE KEY constraint '([^']+)'/i) ||
    msg.match(/constraint \"([^\"]+)\"/i);
  const idx = (mIdx && mIdx[1]) ? mIdx[1] : '';
  const low = idx.toLowerCase();
  let message =
    'Ya existe un registro con esos datos. Revisá nombre de usuario, contraseña o documento.';
  if (low.includes('password')) {
    message =
      'Esa contraseña ya está en uso por otro usuario. La base exige contraseñas únicas: elegí otra distinta.';
  } else if (low.includes('nombrered') || low.includes('nombre_red') || low.includes('usuario')) {
    message = 'Ya existe un usuario con ese nombre de acceso (NombreRed). Elegí otro.';
  } else if (low.includes('documento') || low.includes('dni')) {
    message = 'Ya existe un usuario con ese número de documento.';
  }
  return { statusCode: 409, message };
}

/** ValorPersonal generado por la BD (IDENTITY). Sin CodOperador si es IDENTITY. */
async function insertImPasswordConIdentity(fechaTipo, baseParamsSinCodOperador, fechaClarionHoy) {
  const consulta =
    fechaTipo === 'int'
      ? `
      INSERT INTO imPassword (
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      OUTPUT INSERTED.ValorPersonal AS ValorPersonal
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, N'0', 0)
    `
      : `
      INSERT INTO imPassword (
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      OUTPUT INSERTED.ValorPersonal AS ValorPersonal
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, GETDATE(), N'0', 0)
    `;
  const parametros =
    fechaTipo === 'int'
      ? [...baseParamsSinCodOperador, { value: fechaClarionHoy, type: 'Int' }]
      : baseParamsSinCodOperador;
  const insertado = await executeQuery(consulta, parametros);
  const id = insertado[0]?.ValorPersonal ?? insertado[0]?.valorpersonal;
  if (id == null) throw new Error('No se pudo obtener ValorPersonal tras el INSERT');
  return id;
}

function splitApellidoNombre(apellidoNombre) {
  const s = String(apellidoNombre || '').trim();
  if (!s) return { apellido: '', nombres: '' };
  const comma = s.indexOf(',');
  if (comma >= 0) {
    return {
      apellido: s.slice(0, comma).trim(),
      nombres: s.slice(comma + 1).trim(),
    };
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { apellido: parts[0] || '', nombres: '' };
  return { apellido: parts[0], nombres: parts.slice(1).join(' ') };
}

async function existeImPasswordPorValorPersonal(valorPersonal) {
  const rows = await executeQuery(
    `SELECT TOP 1 ValorPersonal FROM dbo.imPassword WHERE ValorPersonal = @p0`,
    [{ value: valorPersonal, type: 'Int' }],
  );
  return rows.length > 0;
}

async function insertImPasswordManualId(
  fechaTipo,
  omitCodOperador,
  baseParamsSinCod,
  codOperadorVal,
  fechaClarionHoy,
  valorPersonalFijo = null,
) {
  let nuevoValorPersonal = valorPersonalFijo;
  if (nuevoValorPersonal == null) {
    const maxIdResult = await executeQuery(`SELECT MAX(ValorPersonal) as maxId FROM imPassword`);
    nuevoValorPersonal = (maxIdResult[0].maxId || 0) + 1;
  }

  const consulta =
    fechaTipo === 'int'
      ? omitCodOperador
        ? `
      INSERT INTO imPassword (
        ValorPersonal,
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, N'0', 0)
    `
        : `
      INSERT INTO imPassword (
        ValorPersonal,
        CodOperador,
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, N'0', 0)
    `
      : omitCodOperador
        ? `
      INSERT INTO imPassword (
        ValorPersonal,
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, GETDATE(), N'0', 0)
    `
        : `
      INSERT INTO imPassword (
        ValorPersonal,
        CodOperador,
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, GETDATE(), N'0', 0)
    `;

  const parametros = [{ value: nuevoValorPersonal, type: 'Int' }];
  if (!omitCodOperador) {
    parametros.push({ value: codOperadorVal, type: 'VarChar' });
  }
  parametros.push(...baseParamsSinCod);
  if (fechaTipo === 'int') {
    parametros.push({ value: fechaClarionHoy, type: 'Int' });
  }

  await executeQuery(consulta, parametros);
  return nuevoValorPersonal;
}

/**
 * Obtiene todos los usuarios con sus sectores asignados
 * @returns {Promise<Array>} Lista de usuarios
 */
const obtenerTodosLosUsuarios = async () => {
  try {
    // Consulta optimizada con LEFT JOIN para obtener usuarios y sectores en una sola query
    const consulta = `
      SELECT 
        p.ValorPersonal,
        ISNULL(RTRIM(LTRIM(p.CodOperador)), '') as CodOperador,
        ISNULL(RTRIM(LTRIM(p.Apellido)), '') as Apellido,
        ISNULL(RTRIM(LTRIM(p.Nombres)), '') as Nombres,
        ISNULL(RTRIM(LTRIM(p.NombreRed)), '') as NombreRed,
        ISNULL(RTRIM(LTRIM(p.NumeroDocumento)), '') as NumeroDocumento,
        ISNULL(RTRIM(LTRIM(p.Legajo)), '') as Legajo,
        p.MarcadeBaja,
        p.FechaActual,
        ps.idSector,
        s.Descripcion as descripcionSector
      FROM imPassword p
      LEFT JOIN imPersonalSectores ps ON p.ValorPersonal = ps.idPersonal
      LEFT JOIN imSectores s ON ps.idSector = s.Valor
      ORDER BY p.Apellido, p.Nombres
    `;
    
    const resultado = await executeQuery(consulta);
    
    // Agrupar sectores por usuario
    const usuariosMap = new Map();
    
    resultado.forEach(row => {
      const userId = row.ValorPersonal;
      
      if (!usuariosMap.has(userId)) {
        usuariosMap.set(userId, {
          ValorPersonal: row.ValorPersonal,
          CodOperador: row.CodOperador,
          Apellido: row.Apellido,
          Nombres: row.Nombres,
          NombreRed: row.NombreRed,
          NumeroDocumento: row.NumeroDocumento,
          Legajo: row.Legajo,
          MarcadeBaja: row.MarcadeBaja,
          FechaActual: row.FechaActual,
          sectores: []
        });
      }
      
      // Agregar sector si existe
      if (row.idSector) {
        usuariosMap.get(userId).sectores.push({
          idSector: row.idSector,
          descripcionSector: row.descripcionSector
        });
      }
    });
    
    return Array.from(usuariosMap.values());
  } catch (error) {
    console.error('Error al obtener usuarios:', error.message);
    throw error;
  }
};

/**
 * Obtiene un usuario por su ValorPersonal
 * @param {number} valorPersonal - ID del usuario
 * @returns {Promise<Object>} Datos del usuario
 */
const obtenerUsuarioPorId = async (valorPersonal) => {
  try {
    const consulta = `
      SELECT 
        p.ValorPersonal,
        p.CodOperador,
        p.Apellido,
        p.Nombres,
        p.NombreRed,
        p.Password,
        p.NumeroDocumento,
        p.Legajo,
        p.MarcadeBaja,
        p.FechaActual
      FROM imPassword p
      WHERE p.ValorPersonal = @p0
    `;
    
    const resultado = await executeQuery(consulta, [{ value: valorPersonal }]);
    
    if (resultado && resultado.length > 0) {
      const usuario = resultado[0];
      
      // Obtener sectores del usuario
      const sectoresConsulta = `
        SELECT 
          ps.idSector,
          s.Descripcion as descripcionSector
        FROM imPersonalSectores ps
        INNER JOIN imSectores s ON ps.idSector = s.Valor
        WHERE ps.idPersonal = @p0
      `;
      
      const sectores = await executeQuery(sectoresConsulta, [{ value: valorPersonal }]);
      usuario.sectores = sectores || [];
      
      return usuario;
    }
    
    return null;
  } catch (error) {
    console.error('Error al obtener usuario por ID:', error.message);
    throw error;
  }
};

/**
 * Crea un nuevo usuario
 * @param {Object} userData - Datos del nuevo usuario
 * @returns {Promise<Object>} Usuario creado
 */
const crearUsuario = async (userData) => {
  try {
    const { 
      codOperador, 
      apellido, 
      nombres, 
      nombreRed, 
      password, 
      numeroDocumento, 
      legajo 
    } = userData;

    const fechaTipo = await getImPasswordFechaActualTipo();
    const hoy = new Date();
    const fechaLocalStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const fechaClarionHoy = convertirFechaAClarion(fechaLocalStr);

    const baseParamsSinCod = [
      { value: apellido, type: 'VarChar' },
      { value: nombres, type: 'VarChar' },
      { value: nombreRed, type: 'VarChar' },
      { value: password, type: 'VarChar' },
      { value: numeroDocumento || '', type: 'VarChar' },
      { value: legajo || '', type: 'VarChar' }
    ];

    const omitCodOperador = await getImPasswordCodOperadorIsIdentity();
    const usarIdentity = await getImPasswordValorPersonalIsIdentity();
    let nuevoValorPersonal;

    if (usarIdentity) {
      nuevoValorPersonal = await insertImPasswordConIdentity(fechaTipo, baseParamsSinCod, fechaClarionHoy);
    } else {
      try {
        nuevoValorPersonal = await insertImPasswordManualId(
          fechaTipo,
          omitCodOperador,
          baseParamsSinCod,
          codOperador || '',
          fechaClarionHoy
        );
      } catch (err) {
        if (!isSqlIdentityInsertError(err)) throw err;
        if (!omitCodOperador) {
          getTenantSchemaCache().codOperadorIsIdentity = true;
          nuevoValorPersonal = await insertImPasswordManualId(
            fechaTipo,
            true,
            baseParamsSinCod,
            codOperador || '',
            fechaClarionHoy
          );
        } else {
          getTenantSchemaCache().valorPersonalIsIdentity = true;
          nuevoValorPersonal = await insertImPasswordConIdentity(fechaTipo, baseParamsSinCod, fechaClarionHoy);
        }
      }
    }

    const idEmpresa = getTenantId();
    if (idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0) {
      await authCentralSync.vincularUsuarioEmpresaTenant(Number(idEmpresa), nuevoValorPersonal);
    }
    await afterUserMutation(nuevoValorPersonal);

    return await obtenerUsuarioPorId(nuevoValorPersonal);
  } catch (error) {
    const dup = mapDuplicateKeyErrorToHttp(error);
    if (dup) {
      const e = new Error(dup.message);
      e.statusCode = dup.statusCode;
      throw e;
    }
    console.error('Error al crear usuario:', error.message);
    throw error;
  }
};

/**
 * Actualiza la contraseña de un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {string} nuevaPassword - Nueva contraseña
 * @returns {Promise<boolean>} Resultado de la operación
 */
const cambiarPassword = async (valorPersonal, nuevaPassword) => {
  try {
    const consulta = `
      UPDATE imPassword 
      SET Password = @p1
      WHERE ValorPersonal = @p0
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: nuevaPassword, type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    await afterUserMutation(valorPersonal);
    return true;
  } catch (error) {
    console.error('Error al cambiar contraseña:', error.message);
    throw error;
  }
};

/**
 * Asigna un sector a un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {string} idSector - ID del sector
 * @returns {Promise<boolean>} Resultado de la operación
 */
const asignarSector = async (valorPersonal, idSector) => {
  try {
    // Verificar si ya existe la asignación
    const verificarConsulta = `
      SELECT * FROM imPersonalSectores 
      WHERE idPersonal = @p0 AND idSector = @p1
    `;
    
    const existe = await executeQuery(verificarConsulta, [
      { value: valorPersonal },
      { value: idSector, type: 'VarChar' }
    ]);
    
    if (existe && existe.length > 0) {
      throw new Error('El usuario ya tiene asignado este sector');
    }
    
    const consulta = `
      INSERT INTO imPersonalSectores (idPersonal, idSector)
      VALUES (@p0, @p1)
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: idSector, type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    await afterUserMutation(valorPersonal);
    return true;
  } catch (error) {
    console.error('Error al asignar sector:', error.message);
    throw error;
  }
};

/**
 * Quita un sector de un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {string} idSector - ID del sector
 * @returns {Promise<boolean>} Resultado de la operación
 */
const quitarSector = async (valorPersonal, idSector) => {
  try {
    const consulta = `
      DELETE FROM imPersonalSectores 
      WHERE idPersonal = @p0 AND idSector = @p1
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: idSector, type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    const idEmpresa = getTenantId();
    if (idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0) {
      await authCentralSync.removePersonalSector(Number(idEmpresa), valorPersonal, idSector);
    } else {
      await afterUserMutation(valorPersonal);
    }
    return true;
  } catch (error) {
    console.error('Error al quitar sector:', error.message);
    throw error;
  }
};

/**
 * Actualiza los datos básicos de un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {Object} userData - Datos a actualizar
 * @returns {Promise<Object>} Usuario actualizado
 */
const actualizarUsuario = async (valorPersonal, userData) => {
  try {
    const { codOperador, apellido, nombres, nombreRed, numeroDocumento, legajo } = userData;
    
    const consulta = `
      UPDATE imPassword 
      SET 
        CodOperador = @p1,
        Apellido = @p2,
        Nombres = @p3,
        NombreRed = @p4,
        NumeroDocumento = @p5,
        Legajo = @p6
      WHERE ValorPersonal = @p0
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: codOperador || '', type: 'VarChar' },
      { value: apellido, type: 'VarChar' },
      { value: nombres, type: 'VarChar' },
      { value: nombreRed, type: 'VarChar' },
      { value: numeroDocumento || '', type: 'VarChar' },
      { value: legajo || '', type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    await afterUserMutation(valorPersonal);

    return await obtenerUsuarioPorId(valorPersonal);
  } catch (error) {
    console.error('Error al actualizar usuario:', error.message);
    throw error;
  }
};

/**
 * Crea registro en imPassword vinculado al Valor de imPersonal (mismo ValorPersonal).
 * Usado al dar de alta personal con usuario de acceso.
 */
async function crearImPasswordParaPersonal(valorPersonal, data) {
  if (valorPersonal == null || !Number.isFinite(Number(valorPersonal))) {
    const e = new Error('ValorPersonal inválido para crear usuario');
    e.statusCode = 400;
    throw e;
  }
  const vp = Number(valorPersonal);
  if (await existeImPasswordPorValorPersonal(vp)) {
    const e = new Error('Este personal ya tiene un usuario de acceso configurado');
    e.statusCode = 409;
    throw e;
  }

  const nombreRed = String(data.NombreRed || data.nombreRed || '').trim();
  const password = String(data.Password || data.password || '').trim();
  if (!nombreRed) {
    const e = new Error('El nombre de usuario (NombreRed) es obligatorio');
    e.statusCode = 400;
    throw e;
  }
  if (!password || password.length < 4) {
    const e = new Error('La contraseña debe tener al menos 4 caracteres');
    e.statusCode = 400;
    throw e;
  }

  const { apellido, nombres } = splitApellidoNombre(data.ApellidoNombre || data.apellidoNombre);
  const fechaTipo = await getImPasswordFechaActualTipo();
  const hoy = new Date();
  const fechaLocalStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const fechaClarionHoy = convertirFechaAClarion(fechaLocalStr);

  const baseParamsSinCod = [
    { value: data.apellido || apellido, type: 'VarChar' },
    { value: data.nombres || nombres, type: 'VarChar' },
    { value: nombreRed, type: 'VarChar' },
    { value: password, type: 'VarChar' },
    {
      value:
        data.numeroDocumento != null
          ? String(data.numeroDocumento)
          : data.NumeroDocumento != null
            ? String(data.NumeroDocumento)
            : '',
      type: 'VarChar',
    },
    {
      value:
        data.legajo != null
          ? String(data.legajo)
          : data.Legajo != null
            ? String(data.Legajo)
            : String(vp),
      type: 'VarChar',
    },
  ];

  const omitCodOperador = await getImPasswordCodOperadorIsIdentity();
  const usarIdentity = await getImPasswordValorPersonalIsIdentity();

  if (usarIdentity) {
    const e = new Error(
      'La base tiene ValorPersonal autonumérico en imPassword; no se puede vincular al ID del personal. Cree el usuario desde Administración > Usuarios.',
    );
    e.statusCode = 422;
    throw e;
  }

  try {
    await insertImPasswordManualId(
      fechaTipo,
      omitCodOperador,
      baseParamsSinCod,
      data.CodOperador || data.codOperador || '',
      fechaClarionHoy,
      vp,
    );
  } catch (err) {
    const dup = mapDuplicateKeyErrorToHttp(err);
    if (dup) {
      const e = new Error(dup.message);
      e.statusCode = dup.statusCode;
      throw e;
    }
    if (isSqlIdentityInsertError(err)) {
      const e = new Error(
        'No se pudo vincular el usuario al personal (conflicto de ID en imPassword).',
      );
      e.statusCode = 422;
      throw e;
    }
    throw err;
  }

  await afterUserMutation(vp);
  return obtenerUsuarioPorId(vp);
}

/**
 * Cuenta de acceso vinculada a un personal (sin exponer la contraseña).
 * @param {number} valorPersonal
 * @returns {Promise<Object|null>}
 */
async function obtenerCuentaPorPersonal(valorPersonal) {
  const usuario = await obtenerUsuarioPorId(valorPersonal);
  if (!usuario) return null;
  const { Password: _pw, ...sinPassword } = usuario;
  return { tieneCuenta: true, ...sinPassword };
}

module.exports = {
  obtenerTodosLosUsuarios,
  obtenerUsuarioPorId,
  obtenerCuentaPorPersonal,
  crearUsuario,
  crearImPasswordParaPersonal,
  cambiarPassword,
  asignarSector,
  quitarSector,
  actualizarUsuario
};
