/**
 * Script de Análisis de Estructura de Historia Clínica
 * 
 * Este script analiza la tabla imHCI en la base de datos y genera:
 * 1. Lista completa de campos
 * 2. Agrupación por secciones (prefijos)
 * 3. Estadísticas de uso
 * 4. Documentación SQL
 */

const { executeQuery } = require('../src/models/db');
const fs = require('fs');
const path = require('path');

// Configuración de secciones médicas
const SECCIONES_CONFIG = {
  'SV': 'Signos Vitales',
  'PF': 'Piel y Faneras',
  'TCS': 'Tejido Celular Subcutáneo',
  'SL': 'Sistema Linfático',
  'SOAM': 'Sistema Osteoarticulomuscular',
  'C': 'Cabeza',
  'CU': 'Cuello',
  'M': 'Mamas',
  'MI': 'Mamas - Inspección',
  'MP': 'Mamas - Palpación',
  'AR': 'Aparato Respiratorio',
  'AC': 'Aparato Cardiovascular',
  'A': 'Abdomen',
  'AUG': 'Aparato Urogenital',
  'AIG': 'Aparato Intestinal',
  'SN': 'Sistema Nervioso',
  'EO': 'Examen Oftalmológico',
  'EC': 'Electrocardiograma',
  'RDT': 'Radiología de Tórax',
  'PD': 'Procedimientos Diagnósticos',
  'PT': 'Procedimientos Terapéuticos',
  'AD': 'Aparato Digestivo',
  'EN': 'Examen Neurológico',
  'EG': 'Examen Ginecológico',
  'DIA': 'Diabetes'
};

async function analizarEstructuraHCI() {
  console.log('🔍 ANÁLISIS DE ESTRUCTURA DE HISTORIA CLÍNICA\n');
  console.log('='.repeat(80));
  
  try {
    // 1. Obtener estructura de la tabla
    console.log('\n📊 Obteniendo estructura de tabla imHCI...\n');
    
    const columnas = await executeQuery(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE,
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCI'
      ORDER BY ORDINAL_POSITION
    `);

    console.log(`✅ Total de columnas: ${columnas.length}\n`);

    // 2. Agrupar campos por sección
    const camposBasicos = [
      'IdHCIngreso', 'NumeroVisita', 'Fecha', 'IdSector', 'IdProfecional',
      'MotivoConsulta', 'EnfermedadActual', 'IMPRESIONDIAGNOSTICA',
      'COMENTARIODEINGRESO', 'NUMEROVISITA', 'ModMedica', 'Semiologia',
      'EXAMENCOMPLEMENTARIO'
    ];

    const seccionesCampos = {};
    const camposNoAgrupados = [];

    columnas.forEach(col => {
      const nombreCampo = col.COLUMN_NAME;
      
      if (camposBasicos.includes(nombreCampo)) {
        return; // Saltar campos básicos
      }

      // Extraer prefijo
      const prefijo = nombreCampo.split('_')[0];
      
      if (SECCIONES_CONFIG[prefijo]) {
        if (!seccionesCampos[prefijo]) {
          seccionesCampos[prefijo] = [];
        }
        seccionesCampos[prefijo].push({
          nombre: nombreCampo,
          tipo: col.DATA_TYPE,
          longitud: col.CHARACTER_MAXIMUM_LENGTH,
          nullable: col.IS_NULLABLE
        });
      } else {
        camposNoAgrupados.push(nombreCampo);
      }
    });

    // 3. Mostrar resumen por sección
    console.log('📋 CAMPOS POR SECCIÓN:\n');
    console.log('-'.repeat(80));
    
    Object.keys(SECCIONES_CONFIG).forEach(prefijo => {
      const campos = seccionesCampos[prefijo] || [];
      console.log(`\n${prefijo.padEnd(6)} - ${SECCIONES_CONFIG[prefijo].padEnd(40)} (${campos.length} campos)`);
      
      if (campos.length > 0) {
        campos.forEach(campo => {
          const tipo = campo.longitud 
            ? `${campo.tipo}(${campo.longitud})`
            : campo.tipo;
          console.log(`  • ${campo.nombre.padEnd(40)} ${tipo}`);
        });
      }
    });

    // 4. Campos no agrupados
    if (camposNoAgrupados.length > 0) {
      console.log('\n\n⚠️  CAMPOS NO AGRUPADOS:\n');
      camposNoAgrupados.forEach(campo => {
        console.log(`  • ${campo}`);
      });
    }

    // 5. Estadísticas de uso (si hay datos)
    console.log('\n\n📊 ESTADÍSTICAS DE USO:\n');
    console.log('-'.repeat(80));
    
    const totalRegistros = await executeQuery(`
      SELECT COUNT(*) as total FROM imHCI
    `);

    const total = totalRegistros[0].total;
    console.log(`\nTotal de registros en imHCI: ${total}`);

    if (total > 0) {
      // Analizar campos más usados por sección
      for (const [prefijo, nombreSeccion] of Object.entries(SECCIONES_CONFIG)) {
        const campos = seccionesCampos[prefijo] || [];
        
        if (campos.length === 0) continue;

        console.log(`\n${nombreSeccion}:`);
        
        for (const campo of campos.slice(0, 5)) { // Solo primeros 5 campos
          const resultado = await executeQuery(`
            SELECT COUNT(*) as count 
            FROM imHCI 
            WHERE ${campo.nombre} IS NOT NULL 
              AND ${campo.nombre} != '' 
              AND ${campo.nombre} != '0'
          `);
          
          const count = resultado[0].count;
          const porcentaje = ((count / total) * 100).toFixed(2);
          
          if (count > 0) {
            console.log(`  ${campo.nombre.padEnd(40)} ${count.toString().padStart(6)} (${porcentaje}%)`);
          }
        }
      }
    }

    // 6. Generar documentación SQL
    console.log('\n\n📝 Generando documentación SQL...\n');
    
    const sqlDoc = generarDocumentacionSQL(columnas, seccionesCampos);
    const sqlPath = path.join(__dirname, '../docs/ESTRUCTURA_HC_SQL.md');
    fs.writeFileSync(sqlPath, sqlDoc);
    
    console.log(`✅ Documentación SQL guardada en: ${sqlPath}`);

    // 7. Generar TypeScript interfaces
    console.log('\n📝 Generando interfaces TypeScript...\n');
    
    const tsInterfaces = generarInterfacesTypeScript(columnas, seccionesCampos);
    const tsPath = path.join(__dirname, '../docs/INTERFACES_HC.ts');
    fs.writeFileSync(tsPath, tsInterfaces);
    
    console.log(`✅ Interfaces TypeScript guardadas en: ${tsPath}`);

    console.log('\n' + '='.repeat(80));
    console.log('✅ ANÁLISIS COMPLETADO\n');

  } catch (error) {
    console.error('❌ Error durante el análisis:', error);
    throw error;
  }
}

function generarDocumentacionSQL(columnas, seccionesCampos) {
  let doc = `# Estructura SQL - Tabla imHCI\n\n`;
  doc += `**Fecha de generación:** ${new Date().toISOString()}\n\n`;
  doc += `## Campos Básicos\n\n`;
  doc += `\`\`\`sql\n`;
  
  const camposBasicos = columnas.filter(col => 
    ['IdHCIngreso', 'NumeroVisita', 'Fecha', 'IdSector', 'IdProfecional',
     'MotivoConsulta', 'EnfermedadActual', 'IMPRESIONDIAGNOSTICA',
     'COMENTARIODEINGRESO'].includes(col.COLUMN_NAME)
  );

  camposBasicos.forEach(col => {
    const tipo = col.CHARACTER_MAXIMUM_LENGTH 
      ? `${col.DATA_TYPE}(${col.CHARACTER_MAXIMUM_LENGTH})`
      : col.DATA_TYPE;
    const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
    doc += `${col.COLUMN_NAME.padEnd(30)} ${tipo.padEnd(20)} ${nullable}\n`;
  });
  
  doc += `\`\`\`\n\n`;

  // Campos por sección
  Object.keys(SECCIONES_CONFIG).forEach(prefijo => {
    const campos = seccionesCampos[prefijo] || [];
    if (campos.length === 0) return;

    doc += `## ${SECCIONES_CONFIG[prefijo]} (${prefijo})\n\n`;
    doc += `**Total de campos:** ${campos.length}\n\n`;
    doc += `\`\`\`sql\n`;
    
    campos.forEach(campo => {
      const tipo = campo.longitud 
        ? `${campo.tipo}(${campo.longitud})`
        : campo.tipo;
      const nullable = campo.nullable === 'YES' ? 'NULL' : 'NOT NULL';
      doc += `${campo.nombre.padEnd(40)} ${tipo.padEnd(20)} ${nullable}\n`;
    });
    
    doc += `\`\`\`\n\n`;
  });

  return doc;
}

function generarInterfacesTypeScript(columnas, seccionesCampos) {
  let ts = `/**\n`;
  ts += ` * Interfaces TypeScript para Historia Clínica\n`;
  ts += ` * Generado automáticamente desde la base de datos\n`;
  ts += ` * Fecha: ${new Date().toISOString()}\n`;
  ts += ` */\n\n`;

  ts += `export interface HCIItem {\n`;
  
  // Campos básicos
  ts += `  // Campos básicos\n`;
  const camposBasicos = columnas.filter(col => 
    ['IdHCIngreso', 'NumeroVisita', 'Fecha', 'IdSector', 'IdProfecional',
     'MotivoConsulta', 'EnfermedadActual', 'IMPRESIONDIAGNOSTICA',
     'COMENTARIODEINGRESO', 'NUMEROVISITA'].includes(col.COLUMN_NAME)
  );

  camposBasicos.forEach(col => {
    const tsType = mapSQLTypeToTS(col.DATA_TYPE);
    ts += `  ${col.COLUMN_NAME}: ${tsType};\n`;
  });

  ts += `\n`;

  // Campos por sección
  Object.keys(SECCIONES_CONFIG).forEach(prefijo => {
    const campos = seccionesCampos[prefijo] || [];
    if (campos.length === 0) return;

    ts += `  // ${SECCIONES_CONFIG[prefijo]} (${prefijo})\n`;
    
    campos.forEach(campo => {
      const tsType = mapSQLTypeToTS(campo.tipo);
      ts += `  ${campo.nombre}?: ${tsType};\n`;
    });
    
    ts += `\n`;
  });

  ts += `}\n\n`;

  // Interface extendida con médico y sector
  ts += `export interface HCIItemWithMedicoAndSector extends HCIItem {\n`;
  ts += `  medicoInfo?: {\n`;
  ts += `    Valor: number;\n`;
  ts += `    Matricula: number;\n`;
  ts += `    ApellidoNombre: string;\n`;
  ts += `    ValorEspecialidad: number;\n`;
  ts += `    Id: number;\n`;
  ts += `  };\n`;
  ts += `  sectorInfo?: {\n`;
  ts += `    Valor: string;\n`;
  ts += `    Descripcion: string;\n`;
  ts += `  };\n`;
  ts += `}\n`;

  return ts;
}

function mapSQLTypeToTS(sqlType) {
  const typeMap = {
    'int': 'number',
    'bigint': 'number',
    'smallint': 'number',
    'tinyint': 'number',
    'decimal': 'number',
    'numeric': 'number',
    'float': 'number',
    'real': 'number',
    'varchar': 'string',
    'nvarchar': 'string',
    'char': 'string',
    'nchar': 'string',
    'text': 'string',
    'ntext': 'string',
    'datetime': 'string',
    'datetime2': 'string',
    'date': 'string',
    'time': 'string',
    'bit': 'boolean'
  };

  return typeMap[sqlType.toLowerCase()] || 'any';
}

// Ejecutar análisis
if (require.main === module) {
  analizarEstructuraHCI()
    .then(() => {
      console.log('✅ Script completado exitosamente');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error fatal:', error);
      process.exit(1);
    });
}

module.exports = { analizarEstructuraHCI };
