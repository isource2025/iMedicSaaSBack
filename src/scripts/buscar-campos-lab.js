const { executeQuery } = require('../models/db');

async function buscarCamposLab() {
  try {
    // Buscar todas las tablas relacionadas con laboratorio
    const query1 = `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%Lab%' OR TABLE_NAME LIKE '%Examen%'
      ORDER BY TABLE_NAME
    `;
    
    const tablas = await executeQuery(query1);
    console.log('\n=== Tablas relacionadas con Laboratorio ===');
    console.table(tablas);
    
    // Buscar columnas que contengan "referencia", "unidad", "rango"
    const query2 = `
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE (COLUMN_NAME LIKE '%referencia%' 
         OR COLUMN_NAME LIKE '%unidad%'
         OR COLUMN_NAME LIKE '%rango%'
         OR COLUMN_NAME LIKE '%valor%')
        AND TABLE_NAME LIKE '%Lab%'
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `;
    
    const columnas = await executeQuery(query2);
    console.log('\n=== Columnas con referencia/unidad/rango ===');
    console.table(columnas);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

buscarCamposLab();
