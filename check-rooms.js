const db = require('./db');

async function main() {
    try {
        const [rows] = await db.query(`
      SELECT r.roomID, r.roomName, b.buildingCode, 
             CONCAT(b.buildingCode, ' ', r.roomName) AS fullName 
      FROM tblstudyrooms r 
      LEFT JOIN tblbuildings b ON r.buildingID = b.buildingID
    `);
        console.log('Current rooms in database:');
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
    process.exit();
}

main();
