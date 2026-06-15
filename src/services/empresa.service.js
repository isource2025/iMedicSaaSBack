/**
 * Servicio para gestionar la información de la empresa
 */
const { executeQuery, executePlatformQuery } = require('../models/db');
const { isPlatformSqlConfigured } = require('../config/database');
const authCentralService = require('./authCentral.service');

const EMPRESA_SELECT = `
  SELECT
    IDEMPRESA,
    DESCRIPCION,
    calle,
    calle_nro,
    Depto,
    piso,
    localidad,
    Provincia,
    Nro_CUIT,
    Nro_IngBrutos,
    IdTipoIVA,
    TEEmpresa,
    Email
  FROM empresas
`;

async function mapearEmpresaRow(empresa, { skipIva = false } = {}) {
  if (!empresa) return null;

  let condicionIva = '-';
  if (!skipIva && empresa.IdTipoIVA) {
    try {
      const tipoIvaResult = await executeQuery(
        'SELECT Descripcion FROM imIVA WHERE Valor = @param0',
        [{ value: empresa.IdTipoIVA }]
      );
      if (tipoIvaResult && tipoIvaResult.length > 0) {
        condicionIva = tipoIvaResult[0].Descripcion;
      }
    } catch (err) {
      console.error('Error al obtener tipo IVA:', err);
    }
  }

  return {
    id: empresa.IDEMPRESA?.toString() || '1',
    descripcion: empresa.DESCRIPCION?.trim() || 'iMedicWS',
    razonSocial: empresa.DESCRIPCION?.trim() || 'iMedicWS',
    cuit: empresa.Nro_CUIT?.toString() || '-',
    calle: empresa.calle?.trim() || '',
    calle_nro: empresa.calle_nro?.toString() || '',
    Depto: empresa.Depto?.trim() || '',
    piso: empresa.piso?.trim() || '',
    localidad: empresa.localidad?.trim() || '-',
    provincia: empresa.Provincia?.trim() || '-',
    telefono: empresa.TEEmpresa?.trim() || '-',
    email: empresa.Email?.trim() || '-',
    condicionIva,
    ingresosBrutos: empresa.Nro_IngBrutos?.toString() || '0',
    fax: '-',
  };
}

/**
 * Obtiene la información de una empresa por ID
 * @param {number|string} idEmpresa
 */
const obtenerInfoEmpresaPorId = async (idEmpresa) => {
  const id = Number(idEmpresa);
  if (!Number.isFinite(id) || id <= 0) {
    return obtenerInfoEmpresa();
  }

  try {
    if (authCentralService.isAuthCentralEnabled()) {
      try {
        const rowCentral = await authCentralService.obtenerEmpresaPorId(id);
        if (rowCentral) {
          return mapearEmpresaRow(rowCentral, { skipIva: true });
        }
      } catch (e) {
        console.warn(`[authCentral] obtenerInfoEmpresaPorId ${id}:`, e.message);
      }
    }

    if (!isPlatformSqlConfigured()) {
      return {
        id: String(id),
        descripcion: 'iMedicWS',
      };
    }

    const consulta = `${EMPRESA_SELECT} WHERE IDEMPRESA = @p0`;
    const resultado = await executePlatformQuery(consulta, [{ value: id, type: 'Int' }]);
    if (resultado && resultado.length > 0) {
      return mapearEmpresaRow(resultado[0]);
    }
    return obtenerInfoEmpresa();
  } catch (error) {
    console.error('Error al obtener información de la empresa por ID:', error);
    throw error;
  }
};

/**
 * Obtiene la primera empresa (compatibilidad) o la indicada por id
 * @param {number|string|null} [idEmpresa]
 */
const obtenerInfoEmpresa = async (idEmpresa = null) => {
  if (idEmpresa != null && idEmpresa !== '') {
    return obtenerInfoEmpresaPorId(idEmpresa);
  }

  if (authCentralService.isAuthCentralEnabled()) {
    return {
      id: '1',
      descripcion: 'iMedicWS',
    };
  }

  try {
    const resultado = await executeQuery(EMPRESA_SELECT);
    if (resultado && resultado.length > 0) {
      return mapearEmpresaRow(resultado[0]);
    }

    return {
      id: '1',
      descripcion: 'iMedicWS',
    };
  } catch (error) {
    console.error('Error al obtener información de la empresa:', error);
    throw error;
  }
};

module.exports = {
  obtenerInfoEmpresa,
  obtenerInfoEmpresaPorId,
  mapearEmpresaRow,
};
