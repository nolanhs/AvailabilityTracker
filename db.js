// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',        // your MySQL host
    user: 'root',             // your MySQL user
    password: 'YOUR_PASSWORD',// your MySQL root password
    database: 'app',          // database you imported esp32.sql into
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
