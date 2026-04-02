const { executeQuery } = require('../models/db');

async function setupPipeline() {
  try {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CONFIGURANDO PIPELINE PROFESIONAL OCR                ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    // ═══════════════════════════════════════════════════════════════
    // 1. Agregar columna NombreNormalizado
    // ═══════════════════════════════════════════════════════════════
    console.log('1. Verificando columna NombreNormalizado...');
    
    try {
      await executeQuery(`
        ALTER TABLE imHCExamenesLabDetalleConf
        ADD NombreNormalizado VARCHAR(255) NULL
      `);
      console.log('   ✓ Columna NombreNormalizado agregada');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        console.log('   → Columna NombreNormalizado ya existe');
      } else {
        throw error;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. Normalizar datos existentes
    // ═══════════════════════════════════════════════════════════════
    console.log('\n2. Normalizando datos existentes...');
    
    await executeQuery(`
      UPDATE imHCExamenesLabDetalleConf
      SET NombreNormalizado = 
        UPPER(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(Estudio, 'á', 'A'),
                    'é', 'E'
                  ),
                  'í', 'I'
                ),
                'ó', 'O'
              ),
              'ú', 'U'
            ),
            'ñ', 'N'
          )
        )
      WHERE NombreNormalizado IS NULL OR NombreNormalizado = ''
    `);
    console.log('   ✓ Datos normalizados');

    // ═══════════════════════════════════════════════════════════════
    // 3. Crear tabla imParametroAlias
    // ═══════════════════════════════════════════════════════════════
    console.log('\n3. Verificando tabla imParametroAlias...');
    
    try {
      await executeQuery(`
        CREATE TABLE imParametroAlias (
          IdAlias INT IDENTITY(1,1) PRIMARY KEY,
          IdTipoLaboratorio VARCHAR(200) NOT NULL,
          Estudio VARCHAR(90) NOT NULL,
          Alias VARCHAR(255) NOT NULL,
          AliasNormalizado VARCHAR(255) NOT NULL,
          Activo BIT DEFAULT 1,
          FechaCreacion DATETIME DEFAULT GETDATE()
        )
      `);
      console.log('   ✓ Tabla imParametroAlias creada');
      
      // Crear índices
      await executeQuery(`CREATE INDEX IDX_Alias_Normalizado ON imParametroAlias(AliasNormalizado)`);
      await executeQuery(`CREATE INDEX IDX_Alias_TipoEstudio ON imParametroAlias(IdTipoLaboratorio, Estudio)`);
      console.log('   ✓ Índices creados');
      
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('There is already an object')) {
        console.log('   → Tabla imParametroAlias ya existe');
      } else {
        throw error;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. Crear tabla imOCRLog
    // ═══════════════════════════════════════════════════════════════
    console.log('\n4. Verificando tabla imOCRLog...');
    
    try {
      await executeQuery(`
        CREATE TABLE imOCRLog (
          IdLog INT IDENTITY(1,1) PRIMARY KEY,
          IdExamenLaboratorio INT NULL,
          TextoOriginal VARCHAR(500) NOT NULL,
          TextoNormalizado VARCHAR(500) NOT NULL,
          ParametroMatch VARCHAR(90) NULL,
          Score DECIMAL(5,4) NULL,
          TipoMatch VARCHAR(50) NULL,
          FechaProceso DATETIME DEFAULT GETDATE(),
          NumeroVisita INT NULL,
          TipoEstudio VARCHAR(200) NULL
        )
      `);
      console.log('   ✓ Tabla imOCRLog creada');
      
      // Crear índices
      await executeQuery(`CREATE INDEX IDX_OCRLog_Examen ON imOCRLog(IdExamenLaboratorio)`);
      await executeQuery(`CREATE INDEX IDX_OCRLog_Fecha ON imOCRLog(FechaProceso)`);
      console.log('   ✓ Índices creados');
      
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('There is already an object')) {
        console.log('   → Tabla imOCRLog ya existe');
      } else {
        throw error;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. Crear constraint UNIQUE anti-duplicación
    // ═══════════════════════════════════════════════════════════════
    console.log('\n5. Verificando constraint anti-duplicación...');
    
    try {
      // Primero eliminar duplicados si existen
      console.log('   → Limpiando duplicados existentes...');
      await executeQuery(`
        WITH CTE AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY IdExamenLaboratorio, IdTipoLaboratorio, Estudio 
              ORDER BY Orden
            ) AS rn
          FROM imHCExamenesLabDetalle
        )
        DELETE FROM CTE WHERE rn > 1
      `);
      
      // Crear constraint
      await executeQuery(`
        CREATE UNIQUE INDEX UQ_Detalle_Examen_Parametro 
        ON imHCExamenesLabDetalle(IdExamenLaboratorio, IdTipoLaboratorio, Estudio)
      `);
      console.log('   ✓ Constraint anti-duplicación creado');
      
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        console.log('   → Constraint anti-duplicación ya existe');
      } else {
        console.log('   ⚠ No se pudo crear constraint (puede que ya exista):', error.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // VERIFICACIÓN FINAL
    // ═══════════════════════════════════════════════════════════════
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  VERIFICACIÓN FINAL                                   ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const verificacion = await executeQuery(`
      SELECT 
        'imHCExamenesLabDetalleConf' as Tabla,
        COUNT(*) as Registros,
        SUM(CASE WHEN NombreNormalizado IS NOT NULL THEN 1 ELSE 0 END) as Normalizados
      FROM imHCExamenesLabDetalleConf
    `);
    
    console.log('Tabla imHCExamenesLabDetalleConf:');
    console.log(`  - Total registros: ${verificacion[0].Registros}`);
    console.log(`  - Normalizados: ${verificacion[0].Normalizados}`);

    const aliasCount = await executeQuery(`SELECT COUNT(*) as Total FROM imParametroAlias`);
    console.log(`\nTabla imParametroAlias: ${aliasCount[0].Total} registros`);

    const logCount = await executeQuery(`SELECT COUNT(*) as Total FROM imOCRLog`);
    console.log(`Tabla imOCRLog: ${logCount[0].Total} registros`);

    console.log('\n✅ SETUP COMPLETADO EXITOSAMENTE\n');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERROR EN SETUP:', error.message);
    console.error(error);
    process.exit(1);
  }
}

setupPipeline();
