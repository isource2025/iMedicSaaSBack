/**
 * Lectura del historial de cambios de la HC de ingreso (dbo.imHCIAuditoria,
 * que llena el trigger TR_imHCI_Auditoria).
 *
 * Es solo lectura a propósito: un historial que la aplicación puede editar o
 * borrar no sirve como auditoría.
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const { jsonSafe } = require('../utils/jsonSafe');
const { TABLA_AUDITORIA } = require('../utils/auditoriaHci');

/** Tope de filas por consulta: un borrado guarda una fila por campo. */
const LIMITE_FILAS = 2000;

const instaladaPorTenant = new Map();

/**
 * ¿La BD del tenant tiene la auditoría instalada?
 * Un tenant sin instalar no es un error: devuelve historial vacío y avisa.
 */
const auditoriaInstalada = async () => {
    const clave = String(getTenantId() ?? 'plataforma');
    if (instaladaPorTenant.get(clave)) return true;

    const filas = await executeQuery(
        `SELECT OBJECT_ID('dbo.${TABLA_AUDITORIA}', 'U') AS tabla`,
    );
    const instalada = filas[0]?.tabla != null;
    if (instalada) instaladaPorTenant.set(clave, true);
    return instalada;
};

const consultar = async (where, params) => {
    const sql = `
        SELECT TOP ${LIMITE_FILAS}
            IdHCIngreso, NumeroVisita, Accion, FechaHora, Lote, Origen, Usuario,
            IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo
        FROM dbo.${TABLA_AUDITORIA}
        WHERE ${where}
        ORDER BY FechaHora DESC, Lote, Columna
    `;
    return executeQuery(sql, params);
};

/**
 * Agrupa por lote: un lote es una sentencia, o sea un guardado.
 * Las filas con Columna NULL son el marcador del evento (alta o borrado).
 */
const agruparPorLote = (filas) => {
    const lotes = new Map();

    for (const f of filas) {
        const clave = `${f.Lote}|${f.IdHCIngreso}`;
        if (!lotes.has(clave)) {
            lotes.set(clave, {
                lote: f.Lote,
                idHCIngreso: f.IdHCIngreso,
                numeroVisita: f.NumeroVisita,
                accion: f.Accion,
                fechaHora: f.FechaHora,
                origen: f.Origen,
                usuario: f.Usuario,
                idOperador: f.IdOperador,
                loginSql: f.LoginSql,
                aplicacion: f.Aplicacion,
                host: f.Host,
                campos: [],
            });
        }
        if (f.Columna !== null) {
            lotes.get(clave).campos.push({
                columna: f.Columna,
                valorAnterior: f.ValorAnterior,
                valorNuevo: f.ValorNuevo,
            });
        }
    }

    return [...lotes.values()];
};

const vacio = (instalada) => ({ instalada, truncado: false, movimientos: [] });

const armarRespuesta = async (where, params) => {
    if (!(await auditoriaInstalada())) return vacio(false);

    const filas = await consultar(where, params);
    return {
        instalada: true,
        truncado: filas.length >= LIMITE_FILAS,
        movimientos: jsonSafe(agruparPorLote(filas)),
    };
};

const obtenerPorHC = async (idHCIngreso) =>
    armarRespuesta('IdHCIngreso = @param0', [{ value: Number(idHCIngreso) }]);

const obtenerPorVisita = async (numeroVisita) =>
    armarRespuesta('NumeroVisita = @param0', [{ value: Number(numeroVisita) }]);

module.exports = { obtenerPorHC, obtenerPorVisita, auditoriaInstalada };
