require('dotenv').config();
const { connectDB } = require('../src/config/database');

(async () => {
    const pool = await connectDB();
    const r = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'imInterCtrlFrecuente' 
        ORDER BY ORDINAL_POSITION
    `);
    r.recordset.forEach(row => {
        console.log(
            row.COLUMN_NAME.padEnd(30), 
            row.DATA_TYPE.padEnd(15), 
            String(row.CHARACTER_MAXIMUM_LENGTH || '').padEnd(6),
            row.IS_NULLABLE
        );
    });
    process.exit(0);
})();
