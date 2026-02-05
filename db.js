// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'toor',
    database: 'app',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnectionCB = async function (callback) {
    try {
        const conn = await pool.getConnection();
        callback(null, conn);
    } catch (err) {
        callback(err);
    }
};

module.exports = pool;
