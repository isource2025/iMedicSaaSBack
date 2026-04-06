const usersService = require('../services/users.service');

/**
 * Obtiene todos los usuarios
 */
const obtenerUsuarios = async (req, res) => {
  try {
    const usuarios = await usersService.obtenerTodosLosUsuarios();
    res.json({
      success: true,
      data: usuarios
    });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los usuarios'
    });
  }
};

/**
 * Obtiene un usuario por ID
 */
const obtenerUsuario = async (req, res) => {
  const { id } = req.params;
  
  try {
    const usuario = await usersService.obtenerUsuarioPorId(parseInt(id));
    
    if (!usuario) {
      return res.status(404).json({
        success: false,
        mensaje: 'Usuario no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: usuario
    });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener el usuario'
    });
  }
};

/**
 * Crea un nuevo usuario
 */
const crearUsuario = async (req, res) => {
  try {
    const usuario = await usersService.crearUsuario(req.body);
    res.status(201).json({
      success: true,
      mensaje: 'Usuario creado exitosamente',
      data: usuario
    });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    const status = error.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    res.status(status).json({
      success: false,
      mensaje: error.message || 'Error al crear el usuario'
    });
  }
};

/**
 * Actualiza los datos de un usuario
 */
const actualizarUsuario = async (req, res) => {
  const { id } = req.params;
  
  try {
    const usuario = await usersService.actualizarUsuario(parseInt(id), req.body);
    res.json({
      success: true,
      mensaje: 'Usuario actualizado exitosamente',
      data: usuario
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar el usuario'
    });
  }
};

/**
 * Cambia la contraseña de un usuario
 */
const cambiarPassword = async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      mensaje: 'La contraseña es requerida'
    });
  }
  
  try {
    await usersService.cambiarPassword(parseInt(id), password);
    res.json({
      success: true,
      mensaje: 'Contraseña actualizada exitosamente'
    });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al cambiar la contraseña'
    });
  }
};

/**
 * Asigna un sector a un usuario
 */
const asignarSector = async (req, res) => {
  const { id } = req.params;
  const { idSector } = req.body;
  
  if (!idSector) {
    return res.status(400).json({
      success: false,
      mensaje: 'El ID del sector es requerido'
    });
  }
  
  try {
    await usersService.asignarSector(parseInt(id), idSector);
    res.json({
      success: true,
      mensaje: 'Sector asignado exitosamente'
    });
  } catch (error) {
    console.error('Error al asignar sector:', error);
    res.status(500).json({
      success: false,
      mensaje: error.message || 'Error al asignar el sector'
    });
  }
};

/**
 * Quita un sector de un usuario
 */
const quitarSector = async (req, res) => {
  const { id, idSector } = req.params;
  
  try {
    await usersService.quitarSector(parseInt(id), idSector);
    res.json({
      success: true,
      mensaje: 'Sector removido exitosamente'
    });
  } catch (error) {
    console.error('Error al quitar sector:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al quitar el sector'
    });
  }
};

module.exports = {
  obtenerUsuarios,
  obtenerUsuario,
  crearUsuario,
  actualizarUsuario,
  cambiarPassword,
  asignarSector,
  quitarSector
};
