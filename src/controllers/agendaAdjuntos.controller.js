/**
 * Adjuntos de turnos de agenda (pre-cierre, vinculados por IdTurno).
 */
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const adjuntosService = require('../services/adjuntos.service');
const racService = require('../services/agendaRac.service');
const { notificarNuevoAdjunto } = require('../services/notificacionesAdjuntos.service');

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || 'http://181.4.71.230:3002';
const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);
const FILE_SERVER_FALLBACK_LOCAL =
  process.env.FILE_SERVER_FALLBACK_LOCAL === '1' ||
  process.env.ADJUNTOS_LOCAL_FALLBACK === '1' ||
  process.env.NODE_ENV !== 'production';

function resolveUserId(req) {
  return req.valorPersonal || req.auth?.usuario?.id || null;
}

function isFileServerNetworkError(err) {
  const code = err && (err.code || (err.cause && err.cause.code));
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNABORTED'
  );
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const uploadPath = path.join(__dirname, '../../uploads', year.toString(), month);
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50);
    cb(null, `${baseName}_${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

async function listarAdjuntosTurno(req, res) {
  try {
    const idTurno = Number(req.params.idTurno);
    await racService.assertAlcanceTurno(idTurno, req);
    const data = await adjuntosService.getAdjuntosPorTurno(idTurno);
    res.json({ success: true, data });
  } catch (e) {
    const code = e?.statusCode || 500;
    res.status(code).json({ success: false, mensaje: e?.message || 'Error interno' });
  }
}

async function subirAdjuntoTurno(req, res) {
  const idTurno = Number(req.params.idTurno);
  try {
    await racService.assertAlcanceTurno(idTurno, req);
    const { tipoImagen } = req.body || {};
    const userId = resolveUserId(req);

    if (!req.file) {
      return res.status(400).json({ success: false, mensaje: 'No se proporcionó ningún archivo' });
    }
    if (!tipoImagen || !String(tipoImagen).trim()) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        success: false,
        mensaje: 'tipoImagen es obligatorio (código HCTiposImagenes)',
      });
    }

    const nombrePaciente = await adjuntosService.getNombrePacientePorTurno(idTurno);
    let filePath;

    try {
      const formData = new FormData();
      formData.append('file', fsSync.createReadStream(req.file.path), req.file.originalname);
      formData.append('numeroVisita', String(idTurno));
      formData.append('nombrePaciente', nombrePaciente);

      const uploadResponse = await axios.post(`${FILE_SERVER_URL}/upload`, formData, {
        headers: formData.getHeaders(),
        timeout: FILE_SERVER_TIMEOUT_MS,
      });

      if (!uploadResponse.data.success) {
        throw new Error(uploadResponse.data.error || 'Error al subir archivo al servidor');
      }
      filePath = uploadResponse.data.filePath;
      await fs.unlink(req.file.path).catch(() => {});
    } catch (remoteErr) {
      if (FILE_SERVER_FALLBACK_LOCAL && isFileServerNetworkError(remoteErr)) {
        filePath = path.resolve(req.file.path);
      } else {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(503).json({
          success: false,
          mensaje: remoteErr.message || 'No se pudo subir el archivo',
        });
      }
    }

    const result = await adjuntosService.subirAdjunto(
      {
        numeroVisita: 0,
        idTurno,
        idTipoImagen: String(tipoImagen).trim(),
      },
      req.file,
      userId,
      filePath,
    );

    await notificarNuevoAdjunto({
      numeroVisita: 0,
      idTurno,
      idAdjunto: result.idAdjunto,
      nombreArchivo: req.file.originalname,
      valorPersonalUploader: userId,
    });

    res.status(201).json({ success: true, data: result });
  } catch (e) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    const code = e?.statusCode || 500;
    res.status(code).json({ success: false, mensaje: e?.message || 'Error interno' });
  }
}

module.exports = {
  uploadMiddleware: upload.single('archivo'),
  listarAdjuntosTurno,
  subirAdjuntoTurno,
};
