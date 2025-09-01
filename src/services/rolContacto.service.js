/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la tabla imRolContacto
 * @module services/rolContacto.service
 */

const { executeQuery } = require('../config/database');

/**
 * Servicio para gestionar los roles de contacto
 */
const rolContactoService = {
  /**
   * Obtiene todos los roles de contacto
   * @returns {Promise<Array>} Lista de roles de contacto
   */
  getRolesContacto: async () => {
    try {
      const query = 'SELECT Valor, Descripcion FROM imRolContacto ORDER BY Descripcion';
      const result = await executeQuery(query);
      
      return result;
    } catch (error) {
      console.error('Error al obtener roles de contacto:', error);
      throw error;
    }
  },

  /**
   * Obtiene un rol de contacto específico por su valor
   * @param {string} valor - Valor del rol de contacto a buscar
   * @returns {Promise<Object|null>} Rol de contacto encontrado o null
   */
  getRolContacto: async (valor) => {
    try {
      const query = 'SELECT Valor, Descripcion FROM imRolContacto WHERE Valor = ?';
      const result = await executeQuery(query, [valor]);
      
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener rol de contacto con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea un nuevo rol de contacto
   * @param {Object} rolContacto - Datos del rol de contacto a crear
   * @param {string} rolContacto.Valor - Valor del rol de contacto (3 caracteres)
   * @param {string} rolContacto.Descripcion - Descripción del rol de contacto
   * @returns {Promise<Object>} Rol de contacto creado
   */
  createRolContacto: async (rolContacto) => {
    try {
      // Validar que todos los campos requeridos estén presentes
      if (!rolContacto.Valor || !rolContacto.Descripcion) {
        throw new Error('Todos los campos son obligatorios');
      }
      
      // Validar que el valor tenga el formato correcto (3 caracteres)
      if (rolContacto.Valor.length > 3) {
        throw new Error('El valor debe tener como máximo 3 caracteres');
      }
      
      // Validar longitud de la descripción
      if (rolContacto.Descripcion.length > 80) {
        throw new Error('La descripción no puede exceder los 80 caracteres');
      }
      
      // Verificar si ya existe un rol de contacto con el mismo valor
      const existingRolContacto = await rolContactoService.getRolContacto(rolContacto.Valor);
      if (existingRolContacto) {
        throw new Error(`Ya existe un rol de contacto con el valor ${rolContacto.Valor}`);
      }
      
      // Insertar el nuevo rol de contacto
      const query = 'INSERT INTO imRolContacto (Valor, Descripcion) VALUES (?, ?)';
      await executeQuery(query, [rolContacto.Valor, rolContacto.Descripcion]);
      
      // Devolver el rol de contacto recién creado
      return await rolContactoService.getRolContacto(rolContacto.Valor);
    } catch (error) {
      console.error('Error al crear rol de contacto:', error);
      throw error;
    }
  },

  /**
   * Actualiza un rol de contacto existente
   * @param {string} valor - Valor del rol de contacto a actualizar
   * @param {string} descripcion - Nueva descripción
   * @returns {Promise<Object>} Rol de contacto actualizado
   */
  updateRolContacto: async (valor, descripcion) => {
    try {
      // Validar que la descripción no esté vacía
      if (!descripcion) {
        throw new Error('La descripción no puede estar vacía');
      }
      
      // Validar longitud de la descripción
      if (descripcion.length > 80) {
        throw new Error('La descripción no puede exceder los 80 caracteres');
      }
      
      // Verificar si el rol de contacto existe
      const existingRolContacto = await rolContactoService.getRolContacto(valor);
      if (!existingRolContacto) {
        throw new Error(`No existe un rol de contacto con el valor ${valor}`);
      }
      
      // Actualizar el rol de contacto
      const query = 'UPDATE imRolContacto SET Descripcion = ? WHERE Valor = ?';
      await executeQuery(query, [descripcion, valor]);
      
      // Devolver el rol de contacto actualizado
      return await rolContactoService.getRolContacto(valor);
    } catch (error) {
      console.error(`Error al actualizar rol de contacto con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina un rol de contacto
   * @param {string} valor - Valor del rol de contacto a eliminar
   * @returns {Promise<void>}
   */
  deleteRolContacto: async (valor) => {
    try {
      // Verificar si el rol de contacto existe
      const existingRolContacto = await rolContactoService.getRolContacto(valor);
      if (!existingRolContacto) {
        throw new Error(`No existe un rol de contacto con el valor ${valor}`);
      }
      
      // Eliminar el rol de contacto
      const query = 'DELETE FROM imRolContacto WHERE Valor = ?';
      await executeQuery(query, [valor]);
    } catch (error) {
      console.error(`Error al eliminar rol de contacto con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = rolContactoService;
