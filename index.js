const express = require('express');
const cors = require('cors');
const pool = require('./db');
const walletRoutes = require('./wallet');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const { apiLimiter, authLimiter } = require('./middleware/rateLimiter');
require('dotenv').config();

const app = express();

// Trust reverse proxy (e.g. Render, NGINX) for accurate client IP in express-rate-limit
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(apiLimiter);

app.get('/', (req, res) => res.status(200).send('Seamless Wallet API is live!'));

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'Server is running', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// Routes
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/game', gameRoutes);
app.use('/api/v1/payment', paymentRoutes);
app.use('/api/v1/admin', adminRoutes);

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend Server running on port ${PORT}`);
});