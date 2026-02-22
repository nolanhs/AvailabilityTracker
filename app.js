// AI was used to help program this file

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var mqtt = require('mqtt');
const db = require('./db');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// API endpoint for ESP32 updates
let latestData = null;
// MQTT configuration (can be overridden via env)
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'ble/presence';

// connect to MQTT broker
const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: 'node-backend-01',
  reconnectPeriod: 5000,
  clean: true
});


mqttClient.on('connect', (connack) => {
  console.log('Connected to MQTT broker at', MQTT_URL);
  console.log('MQTT connack:', connack && typeof connack === 'object' ? JSON.stringify(connack) : connack);
  mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (err) => {
    if (err) console.error('MQTT subscribe error:', err);
    else console.log('Subscribed to', MQTT_TOPIC);
  });
});

mqttClient.on('error', (err) => {
  try {
    console.error('MQTT error:', err && (err.message || JSON.stringify(err)));
  } catch (e) {
    console.error('MQTT error (unknown):', err);
  }
});

mqttClient.on('reconnect', () => console.log('MQTT client reconnecting...'));
mqttClient.on('offline', () => console.log('MQTT client offline'));
mqttClient.on('close', () => console.log('MQTT connection closed'));

mqttClient.on('message', (topic, message) => {
  const payloadStr = message.toString();
  let roomID = null;
  let roomName = null; // This is the building code (e.g., "AIEB")
  let deviceCount = 0;

  console.log('[MQTT] Message received on topic:', topic);
  console.log('[MQTT] Raw payload:', payloadStr);

  // Try to parse JSON payload to get roomID (room number), roomName (building code), and deviceCount
  try {
    const payloadObj = JSON.parse(payloadStr);
    roomID = payloadObj.roomID;           // Room number (e.g., 216)
    roomName = payloadObj.roomName;        // Building code (e.g., "AIEB")
    // Support both deviceCount and legacy status field
    if (payloadObj.deviceCount !== undefined) {
      deviceCount = parseInt(payloadObj.deviceCount, 10) || 0;
    } else if (payloadObj.status !== undefined) {
      // Legacy support: convert boolean/1/0 to device count
      deviceCount = (payloadObj.status === 1 || payloadObj.status === true) ? 1 : 0;
    }
    console.log('[MQTT] Parsed JSON - roomName:', roomName, 'roomID:', roomID, 'deviceCount:', deviceCount);
  } catch (e) {
    // If not JSON, try simple string parse
    const parsed = parseInt(payloadStr, 10);
    deviceCount = isNaN(parsed) ? 0 : parsed;
    console.log('[MQTT] Simple parse (not JSON) - deviceCount:', deviceCount);
  }

  // Construct fullName for frontend matching (e.g., "AIEB 216")
  const fullName = roomName && roomID ? `${roomName} ${roomID}` : null;
  console.log('[MQTT] Full room name:', fullName);

  // For DB: isOccupied = 1 if any devices detected
  const isOccupied = deviceCount > 0 ? 1 : 0;

  latestData = { topic, payload: payloadStr, deviceCount, ts: Date.now(), roomID, roomName, fullName };
  app.set('latestData', latestData);

  // Update room status in DB using roomID (room number)
  // First, try to find the room by matching building code and room number
  if (roomID && roomName) {
    console.log('[DB] Looking up room with building:', roomName, 'room number:', roomID);
    (async () => {
      try {
        // Find the room by building code and room number
        const [rooms] = await db.query(`
          SELECT r.roomID as dbRoomID 
          FROM tblstudyrooms r 
          JOIN tblbuildings b ON r.buildingID = b.buildingID 
          WHERE b.buildingCode = ? AND r.roomName = ?
        `, [roomName, String(roomID)]);

        if (rooms.length > 0) {
          const dbRoomID = rooms[0].dbRoomID;
          await db.query(`INSERT INTO tblroomstatus (roomID, isOccupied) VALUES (?, ?) ON DUPLICATE KEY UPDATE isOccupied = VALUES(isOccupied)`, [dbRoomID, isOccupied]);
          console.log('[DB] Success! Room', fullName, '(dbID:', dbRoomID, ') updated. Device count:', deviceCount, 'isOccupied:', isOccupied);
        } else {
          // Room not found, create it if building exists
          const [buildings] = await db.query(`SELECT buildingID FROM tblbuildings WHERE buildingCode = ?`, [roomName]);
          if (buildings.length > 0) {
            const buildingID = buildings[0].buildingID;
            const [result] = await db.query(`INSERT INTO tblstudyrooms (buildingID, roomName) VALUES (?, ?)`, [buildingID, String(roomID)]);
            const newRoomID = result.insertId;
            await db.query(`INSERT INTO tblroomstatus (roomID, isOccupied) VALUES (?, ?)`, [newRoomID, isOccupied]);
            console.log('[DB] Created new room', fullName, '(dbID:', newRoomID, ') with device count:', deviceCount);
          } else {
            console.log('[DB] Building', roomName, 'not found in database');
          }
        }
      } catch (err) {
        console.error('[DB] Error updating room status:', err.message);
      }
    })();
  } else if (roomID) {
    // Fallback: just use roomID directly
    console.log('[DB] Updating room by ID:', roomID, 'device count:', deviceCount);
    (async () => {
      try {
        await db.query(`INSERT INTO tblroomstatus (roomID, isOccupied) VALUES (?, ?) ON DUPLICATE KEY UPDATE isOccupied = VALUES(isOccupied)`, [roomID, isOccupied]);
        console.log('[DB] Success! Room', roomID, 'updated. Device count:', deviceCount);
      } catch (err) {
        console.error('[DB] Error updating room status:', err.message);
      }
    })();
  } else {
    console.log('[MQTT] No roomID found in payload');
  }

  const io = app.get('io');
  if (io) {
    console.log('[Socket.io] Emitting sensor-update to', io.engine.clientsCount, 'clients');
    io.emit('sensor-update', latestData);
  } else {
    console.log('[Socket.io] WARNING: io not available!');
  }
});
app.post('/api/update', function (req, res) {
  latestData = req.body;
  req.app.set('latestData', latestData);
  console.log('ESP32 data:', latestData);

  const io = req.app.get('io');
  if (io) io.emit('sensor-update', latestData);

  res.json({ status: 'ok' });
});

// expose latest data via a simple API for the frontend
app.get('/api/latest', function (req, res) {
  res.json({ latestData: req.app.get('latestData') || null });
});

app.get('/api/rooms/status', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.roomID, r.roomName, b.buildingCode,
             CONCAT(b.buildingCode, ' ', r.roomName) AS fullName,
             IFNULL(s.isOccupied, 0) AS isOccupied
      FROM tblstudyrooms r
      LEFT JOIN tblbuildings b ON r.buildingID = b.buildingID
      LEFT JOIN tblroomstatus s ON r.roomID = s.roomID
    `);
    console.log('[API] Returning rooms:', rows.map(r => r.fullName));
    res.json(rows);
  } catch (err) {
    console.error('[API] Error fetching room status:', err);
    res.status(500).json({ error: err.message });
  }
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  const message = err.message || 'Internal Server Error';
  const error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.send('Error: ' + message + (error.stack ? '\n' + error.stack : ''));
});

module.exports = app;
