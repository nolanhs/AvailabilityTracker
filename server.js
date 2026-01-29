// AI was used to help program this file
const express = require("express"); // required because app.js uses it
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app"); // use your app.js

// create HTTP server using app.js
const server = http.createServer(app);

// attach Socket.IO
const io = new Server(server, {
  cors: { origin: "*" }, // allow frontend connections
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

