const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_123';

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
    body('userId')
      .trim()
      .notEmpty()
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('userId can only contain letters, numbers, underscores, and hyphens'),
    body('username').trim().notEmpty().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  validate,
  async (req, res) => {
    const { userId, username, password } = req.body;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const userResult = await client.query(
        'INSERT INTO users (user_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, user_id, username',
        [userId, username, passwordHash]
      );

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
  }
);

// 2. LOGIN USER
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  async (req, res) => {
    const { username, password } = req.body;

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
  }
);

module.exports = router;