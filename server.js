// LIB
const port = process.env.PORT;
const express = require('express');
const bodyparser = require('body-parser');
const nodeFetch = require('node-fetch')
const fetch = require('fetch-cookie')(nodeFetch);
const routes = require('./routes');
const app = express();
const server = app.listen(port);
server.keepAliveTimeout = 61 * 1000;
const logger = require('./logger');
const morgan = require('morgan')
// SSL
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0


app.use(morgan('combined'));

// ROUTES
app.use(bodyparser.json());
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type")
    next()
})
routes(app);

//app.listen(port);
//console.log('Service Outgoing Payment started, port: ' + port);
logger.info(`Service Outgoing Payment started → PORT ${server.address().port}`);