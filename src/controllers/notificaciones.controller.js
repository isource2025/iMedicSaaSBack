const express = require('express');
const router = express.Router();
const notificacionesService = require('../services/notificaciones.service');

function valorPersonalReq(req) {
  const q = req.query.userId ?? req.query.valorPersonal;
  const b = req.body?.userId ?? req.body?.valorPersonal;
  const v = parseInt(String(q ?? b ?? req.user?.id ?? ''), 10);
  return Number.isFinite(v) ? v : null;
}

/**
 * GET /api/notificaciones?userId=1&page=1&limit=20&soloNoLeidas=1
 */
router.get('/', async (req, res) => {
  try {
    const vp = valorPersonalReq(req);
    if (!vp) {
      return res.status(400).json({ success: false, error: 'userId o valorPersonal requerido' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const soloNoLeidas = req.query.soloNoLeidas === '1' || req.query.soloNoLeidas === 'true';
    const result = await notificacionesService.listarPorUsuario(vp, page, limit, soloNoLeidas);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[notificaciones] list', e);
    res.status(500).json({ success: false, error: e.message || 'Error al listar notificaciones' });
  }
});

/**
 * GET /api/notificaciones/unread-count?userId=1
 */
router.get('/unread-count', async (req, res) => {
  try {
    const vp = valorPersonalReq(req);
    if (!vp) {
      return res.status(400).json({ success: false, error: 'userId o valorPersonal requerido' });
    }
    const count = await notificacionesService.contarNoLeidas(vp);
    res.json({ success: true, count });
  } catch (e) {
    console.error('[notificaciones] unread-count', e);
    res.status(500).json({ success: false, error: e.message || 'Error' });
  }
});

/**
 * PUT /api/notificaciones/mark-all-read  (query o body: userId)
 */
router.put('/mark-all-read', async (req, res) => {
  try {
    const vp = valorPersonalReq(req);
    if (!vp) {
      return res.status(400).json({ success: false, error: 'userId o valorPersonal requerido' });
    }
    await notificacionesService.marcarTodasLeidas(vp);
    res.json({ success: true });
  } catch (e) {
    console.error('[notificaciones] mark-all', e);
    res.status(500).json({ success: false, error: e.message || 'Error' });
  }
});

/**
 * PUT /api/notificaciones/:id/read  (query o body: userId)
 */
router.put('/:id/read', async (req, res) => {
  try {
    const vp = valorPersonalReq(req);
    if (!vp) {
      return res.status(400).json({ success: false, error: 'userId o valorPersonal requerido' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: 'id inválido' });
    }
    await notificacionesService.marcarLeida(id, vp);
    res.json({ success: true });
  } catch (e) {
    console.error('[notificaciones] read', e);
    res.status(500).json({ success: false, error: e.message || 'Error' });
  }
});

module.exports = router;
