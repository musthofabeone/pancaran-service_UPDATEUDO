const { Pool, pg } = require('pg')

const pool = new Pool({
  name:'service_payment',
  user: 'h2hadm',
  host: '10.10.16.58',
  database: 'saph2h',
  password: 'susujahe',
  port: 5090
});

module.exports = pool;