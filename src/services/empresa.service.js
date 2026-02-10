/**
 * Servicio para gestionar la información de la empresa
 */
const { executeQuery } = require('../models/db');

/**
 * Obtiene la información de la empresa desde la base de datos
 * @returns {Promise<Object>} Información de la empresa
 */
const obtenerInfoEmpresa = async () => {
  try {
    // Consulta ajustada para la tabla empresas en la base de datos escuela
    const consulta = `
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
      FROM 
        empresas
    `;
    
    const resultado = await executeQuery(consulta);
    
    // Si hay resultados, mapear los campos correctamente
    if (resultado && resultado.length > 0) {
      const empresa = resultado[0];
      
      // Obtener descripción de tipo IVA
      let condicionIva = '-';
      if (empresa.IdTipoIVA) {
        try {
          const tipoIvaResult = await executeQuery(
            'SELECT Descripcion FROM imTipoIVA WHERE Valor = @param0',
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
        condicionIva: condicionIva,
        ingresosBrutos: empresa.Nro_IngBrutos?.toString() || '0',
        fax: '-'
      };
    }
    
    // Si no hay resultados, devolver un objeto con valores por defecto
    return {
      id: '1',
      descripcion: 'iMedicWS'
    };
  } catch (error) {
    console.error('Error al obtener información de la empresa:', error);
    throw error;
  }
};

module.exports = {
  obtenerInfoEmpresa
};
