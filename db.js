const { Pool } = require('pg');
require('dotenv').config();

// Supports DATABASE_URL or individual credentials, with SSL enabled for cloud hosting
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'development' ? false : { rejectUnauthorized: false }
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      ssl: { rejectUnauthorized: false }
    };

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  console.log('PostgreSQL Database se Connection Successfull!');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

module.exports = pool;