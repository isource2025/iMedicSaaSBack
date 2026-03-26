const db = require('../src/models/db');
(async () => {
    try {
        const r = await db.executeQuery(
            "SELECT COLUMN_NAME, LEN(COLUMN_NAME) as len FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='imHCI' AND COLUMN_NAME LIKE '%PARES%'"
        );
        r.forEach(c => console.log(`'${c.COLUMN_NAME}' (len=${c.len})`));
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
})();
