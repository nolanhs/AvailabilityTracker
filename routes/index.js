// AI was used to help program this file
var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
    res.send('Website is running!');
});

module.exports = router;
