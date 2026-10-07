const express = require('express');
const cors = require('cors');
const pool = require('./db');
const walletRoutes = require('./wallet');
const authRoutes = require('./routes/auth');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Root Route
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

// Mount Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/wallet', walletRoutes);

// Server Configuration
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Backend Server running on host ${HOST} port ${PORT}`);
});