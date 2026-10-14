/**
 * Servicio para gestionar la información de la empresa
 */
const fs = require('fs/promises');
const path = require('path');
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

/** Valores de imIVA, para cuando no hay base del tenant a mano (lectura desde la plataforma). */
const IVA_CONOCIDOS = {
  1: 'Responsable Inscripto',
  2: 'Exento',
  3: 'Monotributo',
  4: 'Consumidor Final',
};

async function mapearEmpresaRow(empresa, { skipIva = false } = {}) {
  if (!empresa) return null;

  let condicionIva = (empresa.IdTipoIVA && IVA_CONOCIDOS[Number(empresa.IdTipoIVA)]) || '-';
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
    id: empresa.IDEMPRESA != null ? String(empresa.IDEMPRESA) : '',
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
    idTipoIva: empresa.IdTipoIVA != null ? Number(empresa.IdTipoIVA) : null,
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
      id: '',
      descripcion: 'iMedicWS',
    };
  }

  try {
    const resultado = await executeQuery(EMPRESA_SELECT);
    if (resultado && resultado.length > 0) {
      return mapearEmpresaRow(resultado[0]);
    }

    return {
      id: '',
      descripcion: 'iMedicWS',
    };
  } catch (error) {
    console.error('Error al obtener información de la empresa:', error);
    throw error;
  }
};

const LOGO_MAX_BYTES = 1024 * 1024;

function mimeDeImagen(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function idEmpresaValido(idEmpresa) {
  const id = Number(idEmpresa);
  if (!Number.isFinite(id) || id <= 0) {
    const e = new Error('Se requiere empresa activa en la sesión');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

/**
 * Sin base central (desarrollo local con LOCAL_DEV_ONLY) el logo va a un archivo en
 * uploads/, que no se versiona. En la nube siempre se usa Empresas.Logo (MySQL).
 */
const LOGOS_LOCALES_DIR = path.join(__dirname, '..', '..', 'uploads', 'logos-empresa');
const archivoLogoLocal = (id) => path.join(LOGOS_LOCALES_DIR, `empresa-${id}.img`);

async function resolverIdEmpresa(idEmpresa) {
  if (authCentralService.isAuthCentralEnabled()) return idEmpresaValido(idEmpresa);
  const id = Number(idEmpresa);
  if (Number.isFinite(id) && id > 0) return id;
  const local = await obtenerInfoEmpresa();
  return Number(local?.id) > 0 ? Number(local.id) : 'local';
}

async function leerLogo(id) {
  if (authCentralService.isAuthCentralEnabled()) return authCentralService.obtenerLogoEmpresa(id);
  try {
    return await fs.readFile(archivoLogoLocal(id));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function escribirLogo(id, buffer) {
  if (authCentralService.isAuthCentralEnabled()) return authCentralService.guardarLogoEmpresa(id, buffer);
  if (!buffer) return fs.rm(archivoLogoLocal(id), { force: true });
  await fs.mkdir(LOGOS_LOCALES_DIR, { recursive: true });
  await fs.writeFile(archivoLogoLocal(id), buffer);
}

/** @returns {Promise<{ hasLogo: boolean, mime?: string, dataUrl?: string }>} */
const obtenerLogoEmpresa = async (idEmpresa) => {
  const buf = await leerLogo(await resolverIdEmpresa(idEmpresa));
  const mime = buf && mimeDeImagen(buf);
  if (!mime) return { hasLogo: false };
  return { hasLogo: true, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
};

const guardarLogoEmpresa = async (idEmpresa, buffer) => {
  const id = await resolverIdEmpresa(idEmpresa);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const e = new Error('Adjuntá una imagen (campo archivo)');
    e.statusCode = 400;
    throw e;
  }
  if (buffer.length > LOGO_MAX_BYTES) {
    const e = new Error('El logo no puede superar 1 MB');
    e.statusCode = 400;
    throw e;
  }
  if (!mimeDeImagen(buffer)) {
    const e = new Error('Formato no soportado: usá PNG, JPG o WEBP');
    e.statusCode = 400;
    throw e;
  }
  await escribirLogo(id, buffer);
};

const eliminarLogoEmpresa = async (idEmpresa) => {
  await escribirLogo(await resolverIdEmpresa(idEmpresa), null);
};

/** Diseño de PDF: el front define y completa el esquema; acá solo se acotan claves y tamaño. */
const PDF_DISENO_CLAVES = ['plantilla', 'colorMarca', 'fuente', 'encabezado', 'paciente', 'pie'];
const PDF_DISENO_MAX_BYTES = 16 * 1024;
const DISENOS_LOCALES_DIR = path.join(__dirname, '..', '..', 'uploads', 'pdf-diseno');
const archivoDisenoLocal = (id) => path.join(DISENOS_LOCALES_DIR, `empresa-${id}.json`);

const obtenerPdfDiseno = async (idEmpresa) => {
  const id = await resolverIdEmpresa(idEmpresa);
  let raw = null;
  if (authCentralService.isAuthCentralEnabled()) {
    raw = await authCentralService.obtenerPdfDisenoEmpresa(id);
  } else {
    raw = await fs.readFile(archivoDisenoLocal(id), 'utf8').catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** `diseno` null vuelve al diseño por defecto. */
const guardarPdfDiseno = async (idEmpresa, diseno) => {
  const id = await resolverIdEmpresa(idEmpresa);
  let json = null;
  if (diseno != null) {
    if (typeof diseno !== 'object' || Array.isArray(diseno)) throw errorValidacion('Diseño inválido');
    const limpio = Object.fromEntries(PDF_DISENO_CLAVES.filter((k) => k in diseno).map((k) => [k, diseno[k]]));
    json = JSON.stringify(limpio);
    if (Buffer.byteLength(json) > PDF_DISENO_MAX_BYTES) throw errorValidacion('El diseño es demasiado grande');
  }
  if (authCentralService.isAuthCentralEnabled()) {
    await authCentralService.guardarPdfDisenoEmpresa(id, json);
  } else if (json == null) {
    await fs.rm(archivoDisenoLocal(id), { force: true });
  } else {
    await fs.mkdir(DISENOS_LOCALES_DIR, { recursive: true });
    await fs.writeFile(archivoDisenoLocal(id), json, 'utf8');
  }
  return json ? JSON.parse(json) : null;
};

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.statusCode = 400;
  return e;
}

/** Texto opcional con largo máximo de la columna (char/varchar de Empresas). */
function texto(data, campo, etiqueta, max, { requerido = false } = {}) {
  const v = String(data[campo] ?? '').trim();
  if (!v && requerido) throw errorValidacion(`Falta completar: ${etiqueta}`);
  if (v.length > max) throw errorValidacion(`${etiqueta}: máximo ${max} caracteres`);
  return v || null;
}

/** Número de dígitos (CUIT / IIBB se guardan como DECIMAL(18,0)). */
function digitos(data, campo, etiqueta, { exactos } = {}) {
  const raw = String(data[campo] ?? '').trim();
  if (!raw) return null;
  const d = raw.replace(/[\s.-]/g, '');
  if (!/^\d{1,18}$/.test(d)) throw errorValidacion(`${etiqueta}: solo números`);
  if (exactos && d.length !== exactos) throw errorValidacion(`${etiqueta}: debe tener ${exactos} dígitos`);
  return d;
}

/** Catálogos para el formulario de Institución (base de la clínica). */
const obtenerCatalogosInstitucion = async () => {
  const [iva, provincias] = await Promise.all([
    executeQuery('SELECT Valor, Descripcion FROM imIVA ORDER BY Descripcion').catch(() => []),
    executeQuery(
      "SELECT DISTINCT RTRIM(Descripcion) AS Descripcion FROM imProvincia WHERE ValorNacionalidad = 'AR' ORDER BY 1",
    ).catch(() => []),
  ]);
  return {
    iva: iva.map((r) => ({ valor: Number(r.Valor), descripcion: String(r.Descripcion || '').trim() })),
    provincias: provincias.map((r) => String(r.Descripcion || '').trim()).filter(Boolean),
  };
};

/**
 * Datos institucionales que encabezan los PDFs. Mismos campos que edita el super admin
 * (más piso, depto, provincia, IIBB e IVA), sin tocar conexión ni configuración de plataforma.
 */
const actualizarDatosEmpresa = async (idEmpresa, data = {}) => {
  const id = await resolverIdEmpresa(idEmpresa);
  const email = texto(data, 'email', 'Email', 40);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errorValidacion('Email inválido');
  const nroRaw = String(data.calle_nro ?? '').trim();
  if (nroRaw && !/^\d{1,5}$/.test(nroRaw)) throw errorValidacion('N° de calle: solo números');
  const calleNro = nroRaw ? Number(nroRaw) : null;
  if (calleNro != null && calleNro > 32767) throw errorValidacion('N° de calle demasiado grande');
  const ivaRaw = data.idTipoIva;
  const idTipoIva = ivaRaw == null || ivaRaw === '' ? null : Number(ivaRaw);
  if (idTipoIva != null && !Number.isInteger(idTipoIva)) throw errorValidacion('Condición IVA inválida');

  const d = {
    descripcion: texto(data, 'descripcion', 'Razón social', 80, { requerido: true }),
    calle: texto(data, 'calle', 'Calle', 25),
    calle_nro: calleNro,
    piso: texto(data, 'piso', 'Piso', 3),
    depto: texto(data, 'depto', 'Depto', 4),
    localidad: texto(data, 'localidad', 'Localidad', 30),
    provincia: texto(data, 'provincia', 'Provincia', 30),
    cuit: digitos(data, 'cuit', 'CUIT', { exactos: 11 }),
    ingresosBrutos: digitos(data, 'ingresosBrutos', 'Ingresos brutos'),
    idTipoIva,
    telefono: texto(data, 'telefono', 'Teléfono', 45),
    email,
  };

  if (authCentralService.isAuthCentralEnabled()) {
    await authCentralService.actualizarDatosEmpresa(id, d);
    return obtenerInfoEmpresaPorId(id);
  }

  if (!(Number(id) > 0)) {
    const e = new Error('No hay una empresa registrada para actualizar');
    e.statusCode = 409;
    throw e;
  }
  const ejecutar = isPlatformSqlConfigured() ? executePlatformQuery : executeQuery;
  await ejecutar(
    `UPDATE empresas SET
      DESCRIPCION = @p0, calle = @p1, calle_nro = @p2, piso = @p3, Depto = @p4, localidad = @p5,
      Provincia = @p6, Nro_CUIT = @p7, Nro_IngBrutos = @p8, IdTipoIVA = @p9, TEEmpresa = @p10, Email = @p11
    WHERE IDEMPRESA = @p12`,
    [
      { value: d.descripcion, type: 'VarChar' },
      { value: d.calle, type: 'VarChar' },
      { value: d.calle_nro, type: 'SmallInt' },
      { value: d.piso, type: 'VarChar' },
      { value: d.depto, type: 'VarChar' },
      { value: d.localidad, type: 'VarChar' },
      { value: d.provincia, type: 'VarChar' },
      { value: d.cuit, type: 'VarChar' },
      { value: d.ingresosBrutos, type: 'VarChar' },
      { value: d.idTipoIva, type: 'SmallInt' },
      { value: d.telefono, type: 'VarChar' },
      { value: d.email, type: 'VarChar' },
      { value: Number(id), type: 'Int' },
    ],
  );
  return obtenerInfoEmpresaPorId(id);
};

module.exports = {
  obtenerInfoEmpresa,
  obtenerInfoEmpresaPorId,
  mapearEmpresaRow,
  obtenerLogoEmpresa,
  guardarLogoEmpresa,
  eliminarLogoEmpresa,
  obtenerCatalogosInstitucion,
  actualizarDatosEmpresa,
  obtenerPdfDiseno,
  guardarPdfDiseno,
  LOGO_MAX_BYTES,
};
