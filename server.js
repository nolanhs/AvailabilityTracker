const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());

let latestData = null;

// ESP32 sends data here
app.post("/api/update", (req, res) => {
  latestData = req.body;
  console.log("ESP32 data:", latestData);

  io.emit("sensor-update", latestData);
  res.json({ status: "ok" });
});

// Website connects here
io.on("connection", (socket) => {
  console.log("Website connected");

  if (latestData) {
    socket.emit("sensor-update", latestData);
  }
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
