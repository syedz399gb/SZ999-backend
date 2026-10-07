const { Pool } = require('pg');
require('dotenv').config();

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

// Auto-create necessary tables on startup
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) UNIQUE NOT NULL,
      balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      wallet_id INT REFERENCES wallets(id) ON DELETE CASCADE,
      provider_tx_id VARCHAR(255) UNIQUE NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      type VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed default test user wallet if missing
    INSERT INTO wallets (user_id, balance, currency)
    VALUES ('test_user_1', 1000.00, 'PKR')
    ON CONFLICT (user_id) DO NOTHING;
  `;

  try {
    await pool.query(queryText);
    console.log('Database tables verified and test_user_1 seeded successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err.message);
  }
};

pool.on('connect', () => {
  console.log('PostgreSQL Database Connection Successful!');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Run table setup
initDb();

module.exports = pool;