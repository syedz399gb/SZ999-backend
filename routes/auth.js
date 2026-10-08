const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_123';

// Middleware to check validation results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'INVALID_INPUT', errors: errors.array() });
  }
  next();
};

// 1. REGISTER USER
router.post(
  '/register',
  [
    body('username')
      .trim()
      .notEmpty()
      .isLength({ min: 3 })
      .withMessage('Username or phone number must be at least 3 characters'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters')
  ],
  validate,
  async (req, res) => {
    let { userId, username, password } = req.body;
    
    // Auto-generate userId if frontend doesn't pass one
    if (!userId) {
      userId = `USR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if username already exists
      const existing = await client.query('SELECT user_id FROM users WHERE username = $1', [username]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Username or phone number already registered' });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const userResult = await client.query(
        'INSERT INTO users (user_id, username, password_hash) VALUES ($1, $2, $3) RETURNING user_id, username, created_at',
        [userId, username, passwordHash]
      );

      // Create empty initial wallet
      await client.query(
        'INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, $3)',
        [userId, 0.00, 'PKR']
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        { userId: userResult.rows[0].user_id, username: userResult.rows[0].username },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        status: 'SUCCESS',
        message: 'Account registered successfully',
        token,
        user: userResult.rows[0]
      });

    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Registration failed', details: err.message });
    } finally {
      client.release();
    }
  }
);

// 2. LOGIN USER
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username/phone is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  async (req, res) => {
    const { username, password } = req.body;

    try {
      const userResult = await pool.query('SELECT user_id, username, password_hash FROM users WHERE username = $1', [username]);
      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const user = userResult.rows[0];
      const isMatch = await bcrypt.compare(password, user.password_hash);

      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = jwt.sign(
        { userId: user.user_id, username: user.username },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        status: 'SUCCESS',
        message: 'Login successful',
        token,
        userId: user.user_id,
        username: user.username
      });

    } catch (err) {
      res.status(500).json({ error: 'Login failed', details: err.message });
    }
  }
);

module.exports = router;