const express = require('express');
const cors = require('cors');
const pool = require('./db');
const walletRoutes = require('./wallet');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Root Health Check Route
app.get('/', (req, res) => {
  res.status(200).send('Seamless Wallet API is live!');
});

// Database Health Check Route
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'Server is running',
      db_time: result.rows[0].now
    });
  } catch (err) {
    console.error('Health Check DB Error:', err);
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// Wallet Routes Mount
app.use('/api/v1/wallet', walletRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend Server Port ${PORT} par active hai`);
});