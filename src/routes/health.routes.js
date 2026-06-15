const express = require('express');
const platformHealth = require('../services/platformHealth.service');

const router = express.Router();

/**
 * GET /api/health — liveness (Railway / uptime monitors)
 * GET /api/health?deep=1 — incluye probe SQL por empresa (más lento)
 */
router.get('/', async (req, res) => {
	const deep = ['1', 'true', 'yes'].includes(String(req.query.deep || '').toLowerCase());
	try {
		const health = await platformHealth.getHealth({ deep });
		res.status(health.ok ? 200 : 503).json(health);
	} catch (e) {
		res.status(503).json({
			ok: false,
			error: e.message,
			timestamp: new Date().toISOString(),
		});
	}
});

module.exports = router;
