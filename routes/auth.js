const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_123';

// 1. REGISTER USER & AUTO-CREATE WALLET
router.post('/register', async (req, res) => {
  const { userId, username, password } = req.body;

  if (!userId || !username || !password) {
    return res.status(400).json({ error: 'userId, username, and password are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert User
    const userResult = await client.query(
      'INSERT INTO users (user_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, user_id, username',
      [userId, username, passwordHash]
    );

    // Auto-create Wallet with default balance (1000 PKR)
    await client.query(
      'INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, $3)',
      [userId, 1000.00, 'PKR']
    );

    await client.query('COMMIT');

    res.status(201).json({
      status: 'SUCCESS',
      message: 'User registered and wallet created successfully',
      user: userResult.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'User ID or Username already exists' });
    }
    res.status(500).json({ error: 'Registration failed', details: err.message });
  } finally {
    client.release();
  }
});

// 2. LOGIN USER & ISSUE JWT TOKEN
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token (expires in 24 hours)
    const token = jwt.sign(
      { id: user.id, userId: user.user_id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      status: 'SUCCESS',
      token,
      userId: user.user_id
    });

  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

module.exports = router;