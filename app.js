var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
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
app.post('/api/update', function(req, res) {
  latestData = req.body;
  req.app.set('latestData', latestData);
  console.log('ESP32 data:', latestData);

  const io = req.app.get('io');
  if (io) io.emit('sensor-update', latestData);

  res.json({ status: 'ok' });
});
// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
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
