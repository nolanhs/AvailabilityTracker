require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const db = require("./db");

async function start() {
  try {
    const conn = await db.getConnection(); // promise-based connection
    console.log("Database connected");
    conn.release();
    startServer(); // start your server only if DB is reachable
  } catch (err) {
    console.error("DATABASE NOT CONNECTED:", err.message);
    process.exit(1);
  }
}

start(); // call it immediately


function startServer() {
  // create HTTP server using app.js
  const server = http.createServer(app);

  // attach Socket.IO
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  // make io accessible in app.js
  app.set("io", io);
  // log new Socket.IO connections
  io.on("connection", (socket) => {
    console.log("Website connected:", socket.id);
  });

  // start server
  server.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}
