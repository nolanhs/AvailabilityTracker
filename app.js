// AI was used to help program this file

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var mqtt = require('mqtt');
// const db = require('./db');

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
  const payload = message.toString();
  const detected = payload === '1' || payload.toLowerCase() === 'true';
  latestData = { topic, payload, detected, ts: Date.now() };
  // store on app and notify websocket clients if available
  app.set('latestData', latestData);
  console.log('MQTT message:', topic, payload);
  const io = app.get('io');
  if (io) io.emit('sensor-update', latestData);
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
// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

app.get('/api/rooms/status', async (req, res) => {
  const [rows] = await db.query(`
    SELECT r.roomID, r.roomName, IFNULL(s.isOccupied, 0) AS isOccupied
    FROM tblstudyRooms r
    LEFT JOIN tblroomStatus s ON r.roomID = s.roomID
  `);

  res.json(rows);
});

module.exports = app;
