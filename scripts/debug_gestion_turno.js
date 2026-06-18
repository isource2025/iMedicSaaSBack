#!/usr/bin/env node
/**
 * Debug de gestionTurno sin WhatsApp ni orquestador completo.
 *
 * Uso:
 *   node scripts/debug_gestion_turno.js
 *   node scripts/debug_gestion_turno.js --texto="turno con de biasi para agosto"
 *   node scripts/debug_gestion_turno.js --prof --pref
 *
 * Variables: BOT_DEBUG_GESTION=1 (default on), DB_*, OPENAI_API_KEY (opcional GPT preferencia)
 */
require('dotenv').config();

process.env.BOT_DEBUG_GESTION = process.env.BOT_DEBUG_GESTION ?? '1';

const { runWithTenant } = require('../src/context/tenantContext');
const botGestionTurno = require('../src/services/botGestionTurno.service');
const botAgenda = require('../src/services/botAgenda.service');
const botHerramientas = require('../src/services/botHerramientas.service');

const ARGS = process.argv.slice(2);
const ARG = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const FLAG = (name) => ARGS.includes(`--${name}`);

const EMPRESA = Number(ARG('empresa', process.env.BOT_EMPRESA_ID || '1'));
const TEXTO = ARG('texto', 'turno con de biasi para agosto');

function log(title, obj) {
	console.log(`\n── ${title} ──`);
	console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

async function main() {
	console.log('╔══════════════════════════════════════════════════╗');
	console.log('║  Debug gestionTurno — iMedic bot                 ║');
	console.log('╚══════════════════════════════════════════════════╝');
	console.log(`empresa=${EMPRESA} BOT_DEBUG_GESTION=${process.env.BOT_DEBUG_GESTION}`);
	console.log(`texto: "${TEXTO}"`);

	await runWithTenant(EMPRESA, async () => {
		let gestion = botGestionTurno.ensureGestion({});

		const runProf = FLAG('prof') || !FLAG('pref');
		const runPref = FLAG('pref') || !FLAG('prof');

		if (runProf) {
			const analisis = await botAgenda.analizarPedidoTurnoConProfesional(TEXTO, {});
			log('analizarPedidoTurnoConProfesional', analisis);
			gestion = botGestionTurno.mergeDesdeHerramientas(gestion, [
				{ ok: true, nombre: 'buscar_profesional', datos: analisis },
			]);
		}

		if (runPref) {
			const pref = await botHerramientas.interpretarPreferenciaHorarioGpt(TEXTO, null);
			log('interpretar_preferencia_horario', pref);
			if (pref) {
				gestion = botGestionTurno.mergeDesdeHerramientas(gestion, [
					{ ok: true, nombre: 'interpretar_preferencia_horario', datos: pref },
				]);
			}
		}

		const sugeridas = botGestionTurno.herramientasSugeridasParaTexto(TEXTO, gestion);
		log('herramientas sugeridas', sugeridas.map((s) => s.nombre));

		log('resumen gestión', botGestionTurno.resumenParaPrompt(gestion));
		log('preferencias búsqueda', botGestionTurno.aPreferenciasBusqueda(gestion));

		const espValor = gestion.especialidad?.valor;
		const matricula = gestion.profesional?.matricula;
		if (espValor && FLAG('buscar')) {
			const { excluir, preferir } = botGestionTurno.aPreferenciasBusqueda(gestion);
			const turno = await botAgenda.sugerirPrimerTurnoDisponible(espValor, {
				matricula: matricula || undefined,
				excluir,
				preferir,
			});
			log('turno sugerido', turno);
		} else if (!FLAG('buscar')) {
			console.log('\n(Pasar --buscar para consultar agenda con preferencias)');
		}
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
