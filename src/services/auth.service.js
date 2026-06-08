const { executeQuery, executePlatformQuery } = require('../models/db');
const { isPlatformSqlConfigured } = require('../config/database');
const { runWithTenant, getTenantId } = require('../context/tenantContext');
const tenantRegistry = require('./tenantRegistry.service');
const authCentralService = require('./authCentral.service');

const esErrorEsquemaRoles = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes("invalid object name 'imroles'") ||
    msg.includes("invalid column name 'rol'") ||
    msg.includes("invalid object name 'impersonal'")
  );
};

/** Roles que no deben elegir sector en el login (administradores de tenant o plataforma). */
const eximeSeleccionSectorPorUsuario = (userData) => {
  if (!userData) return false;
  const rolIdRaw = userData.RolId != null ? userData.RolId : userData.Rol;
  const rolId = rolIdRaw != null && rolIdRaw !== '' ? Number(rolIdRaw) : null;
  const rolNombre = String(userData.RolNombre || '').trim().toUpperCase();
  if (rolNombre === 'SUPER_ADMIN' || rolId === 5) return true;
  if (rolNombre === 'ADMIN' || rolId === 1) return true;
  if (Number(userData.Grupo) === 11) return true;
  return false;
};

const SQL_ROL_USUARIO = `
  SELECT TOP 1
    LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS RolId,
    LTRIM(RTRIM(ISNULL(r.Nombre, ''))) AS RolNombre,
    COALESCE(pw.Grupo, 0) AS Grupo
  FROM impassword pw
  LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
  LEFT JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
  WHERE UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@p0)))
     OR UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@p0)))
`;

const obtenerRolUsuarioEnTenant = async (username) => {
  const rolRows = await executeQuery(SQL_ROL_USUARIO, [{ value: username, type: 'VarChar' }]);
  return rolRows[0] || null;
};

const eximeSectorPorUsername = async (username, idEmpresa = null) => {
  if (await esSuperAdminPorUsername(username)) return true;

  if (authCentralService.isAuthCentralEnabled()) {
    try {
      if (await authCentralService.esSuperAdmin(username)) return true;
    } catch (e) {
      console.warn('[authCentral] eximeSectorPorUsername:', e.message);
    }
  }

  if (isPlatformSqlConfigured()) {
    try {
      const rolRows = await executePlatformQuery(SQL_ROL_USUARIO, [
        { value: username, type: 'VarChar' },
      ]);
      if (rolRows.length && eximeSeleccionSectorPorUsuario(rolRows[0])) return true;
    } catch (e) {
      console.warn('[auth] eximeSectorPorUsername plataforma:', e.message);
    }
  }

  const id = idEmpresa != null && idEmpresa !== '' ? Number(idEmpresa) : null;
  if (id && Number.isFinite(id)) {
    try {
      const rol = await runWithTenant(id, () => obtenerRolUsuarioEnTenant(username));
      if (eximeSeleccionSectorPorUsuario(rol)) return true;
    } catch (e) {
      console.warn(`[auth] eximeSectorPorUsername tenant ${id}:`, e.message);
    }
    return false;
  }

  try {
    const candidatos = await tenantRegistry.descubrirEmpresasPorUsuario(username);
    for (const c of candidatos.slice(0, 3)) {
      const rol = await runWithTenant(c.idEmpresa, () => obtenerRolUsuarioEnTenant(username));
      if (eximeSeleccionSectorPorUsuario(rol)) return true;
    }
  } catch (e) {
    console.warn('[auth] eximeSectorPorUsername descubrimiento:', e.message);
  }

  return false;
};

/** Login multi-tenant: resuelve BD por empresa y valida credenciales. */
const autenticarUsuario = async (username, contraseña, idEmpresa = null) => {
  const { usuario } = await tenantRegistry.resolverLogin(username, contraseña, idEmpresa);
  return usuario;
};

/**
 * Obtiene todos los sectores disponibles con sus descripciones
 * @returns {Promise<Array>} Lista de sectores con sus descripciones
 */
const obtenerSectores = async () => {
  try {
    // Realizar JOIN con la tabla imSectores para obtener la descripción
    const consulta = `
      SELECT 
        s.Valor as idSector, 
        s.Descripcion as descripcionSector 
      FROM 
        imSectores s
    `;
    
    const resultado = await executeQuery(consulta);
    console.log('Datos obtenidos de sectores:', JSON.stringify(resultado, null, 2));
    return resultado;
  } catch (error) {
    console.error('Error al obtener sectores:', error.message);
    throw error;
  }
};

/** true si el usuario de red tiene rol SUPER_ADMIN (IdRol 5). */
const esSuperAdminPorUsername = async (username) => {
  if (authCentralService.isAuthCentralEnabled()) {
    try {
      if (await authCentralService.esSuperAdmin(username)) return true;
    } catch (e) {
      console.warn('[authCentral] esSuperAdminPorUsername:', e.message);
    }
    if (!isPlatformSqlConfigured()) return false;
  }

  try {
    const rolRows = await executePlatformQuery(
      `
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(r.Nombre, ''))) AS RolNombre, LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS Rol
      FROM impassword pw
      LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
      LEFT JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
      WHERE UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@p0)))
         OR UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@p0)))
      `,
      [{ value: username, type: 'VarChar' }],
    );
    if (!rolRows.length) return false;
    const rolNombre = String(rolRows[0]?.RolNombre || '').trim().toUpperCase();
    const rolId = String(rolRows[0]?.Rol || '').trim();
    return rolNombre === 'SUPER_ADMIN' || rolId === '5';
  } catch {
    return false;
  }
};

/**
 * Obtiene los sectores disponibles para un usuario específico
 * @param {string} username - Nombre de usuario
 * @returns {Promise<Array>} Lista de sectores filtrados para el usuario
 */
const obtenerSectoresPorUsuario = async (username) => {
  try {
    if (await eximeSectorPorUsername(username)) {
      return [];
    }

    if (authCentralService.isAuthCentralEnabled() && !isPlatformSqlConfigured()) {
      try {
        const empresas = await authCentralService.descubrirEmpresas(username);
        if (empresas.length === 1) {
          return authCentralService.obtenerSectores(username, empresas[0].idEmpresa);
        }
      } catch (e) {
        console.warn('[authCentral] obtenerSectoresPorUsuario sin idEmpresa:', e.message);
      }
      return [];
    }

    // Realizar consulta con JOIN para obtener solo los sectores asociados al usuario
    // Usar UPPER y RTRIM para hacer la comparación case-insensitive y sin espacios
    const consulta = `
      SELECT 
        ps.idPersonal as idPersonal,
        ps.idSector as idSector, 
        s.Descripcion as descripcionSector 
      FROM 
        impassword pw
      INNER JOIN 
        imPersonalSectores ps ON pw.ValorPersonal = ps.idPersonal
      INNER JOIN 
        imSectores s ON ps.idSector = s.Valor
      WHERE 
        UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@p0)))
    `;
    
    const parametros = [{ 
      value: username,
      type: 'VarChar' // Especificar tipo VARCHAR para manejar números como strings
    }];
    console.log(`Ejecutando consulta SQL:\n${consulta}\nCon parámetro: ${username}`);
    const resultado = await executeQuery(consulta, parametros);
    console.log(`✅ Resultado CRUDO de la consulta:`, resultado);
    console.log(`✅ Tipo de resultado:`, typeof resultado, Array.isArray(resultado));
    console.log(`✅ Cantidad de registros:`, resultado ? resultado.length : 0);
    console.log(`Sectores filtrados para usuario ${username}:`, JSON.stringify(resultado, null, 2));
    return resultado;
  } catch (error) {
    console.error(`Error al obtener sectores para usuario ${username}:`, error.message);
    throw error;
  }
};

/**
 * Obtiene el idSector y la descripción correspondiente a un idPersonal
 * @param {string} idPersonal - ID del personal
 * @returns {Promise<Object>} Información del sector (idSector y descripción)
 */
const obtenerIdSectorPorIdPersonal = async (idPersonal) => {
  try {
    if (!idPersonal) {
      return null;
    }

    const idEmpresa = getTenantId();
    if (idEmpresa && authCentralService.isAuthCentralEnabled()) {
      try {
        const row = await authCentralService.obtenerSectorPorPersonal(idEmpresa, idPersonal);
        if (row?.idSector) return row;
      } catch (e) {
        console.warn(`[authCentral] obtenerIdSectorPorIdPersonal ${idPersonal}:`, e.message);
      }
    }
    
    const consulta = `
      SELECT 
        ps.idSector,
        s.Descripcion as descripcion
      FROM 
        imPersonalSectores ps
      INNER JOIN 
        imSectores s ON ps.idSector = s.Valor
      WHERE 
        ps.idPersonal = @p0
    `;
    
    const parametros = [{ value: idPersonal }];
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      console.log(`Sector encontrado para idPersonal ${idPersonal}:`, JSON.stringify(resultado[0], null, 2));
      return resultado[0];
    }
    
    console.warn(`No se encontró ningún sector para idPersonal ${idPersonal}`);
    return null;
  } catch (error) {
    console.error(`Error al obtener sector para idPersonal ${idPersonal}:`, error.message);
    throw error;
  }
};

/**
 * Autentica con credenciales temporales (contingencia)
 * @param {string} username - Nombre de usuario
 * @param {string} contraseña - Contraseña del usuario
 * @returns {Promise<boolean>} Resultado de la autenticación
 */
const autenticarConCredencialesTemporales = async (username, contraseña) => {
  // Credenciales temporales para modo de contingencia
  return username === 'admin' && contraseña === 'admin';
};

/**
 * Obtiene la descripción de un sector basado en su idSector
 * @param {string} idSector - ID del sector
 * @returns {Promise<Object>} Objeto con la descripción del sector
 */
/**
 * Todas las empresas (login SUPER_ADMIN).
 */
const obtenerTodasEmpresas = async () => {
  if (authCentralService.isAuthCentralEnabled()) {
    try {
      const rows = await authCentralService.obtenerTodasEmpresas();
      if (rows.length) return rows;
    } catch (e) {
      console.warn('[authCentral] obtenerTodasEmpresas:', e.message);
    }
  }
  try {
    const rows = await executePlatformQuery(
      `SELECT IDEMPRESA AS idEmpresa, RTRIM(LTRIM(ISNULL(DESCRIPCION, ''))) AS descripcionEmpresa
       FROM dbo.Empresas ORDER BY DESCRIPCION`,
    );
    return rows || [];
  } catch (error) {
    console.error('Error al obtener todas las empresas:', error.message);
    if (authCentralService.isAuthCentralEnabled() && !isPlatformSqlConfigured()) {
      return [];
    }
    throw error;
  }
};

/** Descubre empresas para el formulario de login (sin contraseña). */
const descubrirEmpresasLogin = async (username) => {
  try {
    if (await esSuperAdminPorUsername(username)) {
      return { empresas: [], esSuperAdmin: true, requiereSector: false };
    }

    const found = await tenantRegistry.descubrirEmpresasPorUsuario(username);
    const empresas = found.map((e) => ({
      idEmpresa: e.idEmpresa,
      descripcionEmpresa: e.descripcionEmpresa,
    }));

    const eximeSector = await eximeSectorPorUsername(username);
    return { empresas, esSuperAdmin: false, requiereSector: !eximeSector };
  } catch (error) {
    console.error('descubrirEmpresasLogin:', error.message);
    return { empresas: [], esSuperAdmin: false, requiereSector: true };
  }
};

/**
 * Empresas asociadas al personal del usuario (imPersonalEmpresas).
 * SUPER_ADMIN recibe el catálogo completo.
 */
const obtenerEmpresasPorUsuario = async (username, idEmpresaContexto = null) => {
  try {
    const { empresas: descubiertas, esSuperAdmin } = await descubrirEmpresasLogin(username);
    if (esSuperAdmin) return [];
    if (descubiertas.length) return descubiertas;

    const idCtx = idEmpresaContexto != null ? Number(idEmpresaContexto) : null;
    if (idCtx && Number.isFinite(idCtx)) {
      return runWithTenant(idCtx, () => obtenerEmpresasPorUsuarioEnTenant(username));
    }

    return [];
  } catch (error) {
    console.error(`Error al obtener empresas para usuario ${username}:`, error.message);
    throw error;
  }
};

const obtenerEmpresasPorUsuarioEnTenant = async (username) => {
  try {
    const rolRows = await executeQuery(
      `
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS Rol, r.Nombre AS RolNombre
      FROM impassword pw
      LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
      LEFT JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
      WHERE UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@p0)))
         OR UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@p0)))
      `,
      [{ value: username, type: 'VarChar' }],
    );
    const rolNombre = String(rolRows[0]?.RolNombre || '').trim().toUpperCase();
    const rolId = String(rolRows[0]?.Rol || '').trim();
    if (rolNombre === 'SUPER_ADMIN' || rolId === '5') {
      return obtenerTodasEmpresas();
    }

    const consulta = `
      SELECT
        pe.IdEmpresa AS idEmpresa,
        RTRIM(LTRIM(ISNULL(e.DESCRIPCION, ''))) AS descripcionEmpresa
      FROM impassword pw
      INNER JOIN dbo.imPersonalEmpresas pe ON pe.IdPersonal = pw.ValorPersonal
      INNER JOIN dbo.Empresas e ON e.IDEMPRESA = pe.IdEmpresa
      WHERE UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@p0)))
         OR UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@p0)))
      ORDER BY e.DESCRIPCION
    `;

    const parametros = [{ value: username, type: 'VarChar' }];
    const resultado = await executeQuery(consulta, parametros);
    return resultado || [];
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes("invalid object name 'impersonalempresas'")) {
      console.warn('imPersonalEmpresas no disponible; sin empresas por usuario');
      return [];
    }
    throw error;
  }
};

const obtenerSectoresPorUsuarioConTenant = async (username, idEmpresa) => {
  if (await eximeSectorPorUsername(username, idEmpresa)) {
    return [];
  }

  const id = idEmpresa != null ? Number(idEmpresa) : null;
  if (id && Number.isFinite(id) && authCentralService.isAuthCentralEnabled()) {
    try {
      const central = await authCentralService.obtenerSectores(username, id);
      if (central.length) return central;
    } catch (e) {
      console.warn(`[authCentral] sectores empresa ${id}:`, e.message);
    }
  }
  if (id && Number.isFinite(id)) {
    return runWithTenant(id, () => obtenerSectoresPorUsuario(username));
  }

  if (authCentralService.isAuthCentralEnabled()) {
    try {
      const empresas = await authCentralService.descubrirEmpresas(username);
      if (empresas.length === 1) {
        const central = await authCentralService.obtenerSectores(username, empresas[0].idEmpresa);
        if (central.length) return central;
      }
    } catch (e) {
      console.warn('[authCentral] obtenerSectoresPorUsuarioConTenant:', e.message);
    }
    if (!isPlatformSqlConfigured()) {
      return [];
    }
  }

  return obtenerSectoresPorUsuario(username);
};

const obtenerDescripcionSector = async (idSector) => {
  try {
    if (!idSector) {
      return null;
    }

    const idEmpresa = getTenantId();
    if (idEmpresa && authCentralService.isAuthCentralEnabled()) {
      try {
        const row = await authCentralService.obtenerDescripcionSector(idEmpresa, idSector);
        if (row?.idSector) return row;
      } catch (e) {
        console.warn(`[authCentral] obtenerDescripcionSector ${idSector}:`, e.message);
      }
    }
    
    const consulta = `
      SELECT 
        Valor as idSector,
        Descripcion as descripcion
      FROM 
        imSectores
      WHERE 
        Valor = @p0
    `;
    
    const parametros = [{ value: idSector }];
    console.log(`Consultando descripción para idSector: ${idSector}`);
    
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      console.log(`Descripción encontrada para idSector ${idSector}:`, JSON.stringify(resultado[0], null, 2));
      return resultado[0];
    }
    
    console.warn(`No se encontró descripción para idSector ${idSector}`);
    return null;
  } catch (error) {
    console.error(`Error al obtener descripción para idSector ${idSector}:`, error.message);
    throw error;
  }
};

module.exports = {
  autenticarUsuario,
  autenticarConCredencialesTemporales,
  obtenerSectores,
  obtenerSectoresPorUsuario,
  obtenerSectoresPorUsuarioConTenant,
  obtenerEmpresasPorUsuario,
  descubrirEmpresasLogin,
  obtenerTodasEmpresas,
  obtenerIdSectorPorIdPersonal,
  obtenerDescripcionSector,
  esSuperAdminPorUsername,
  eximeSeleccionSectorPorUsuario,
  eximeSectorPorUsername,
};
