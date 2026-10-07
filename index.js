const express = require('express');
const router = express.Router();
const pool = require('./db');
const redisClient = require('./redisClient'); // Adjust path if needed

// GET Balance
router.get('/balance/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    let cachedBalance = null;

    // 1. Try fetching from Redis cache safely
    try {
      if (redisClient && redisClient.isOpen) {
        cachedBalance = await redisClient.get(`balance:${userId}`);
      }
    } catch (redisErr) {
      console.warn('Redis Cache Miss/Error:', redisErr.message);
    }

    if (cachedBalance !== null) {
      return res.status(200).json({
        userId,
        balance: parseFloat(cachedBalance),
        source: 'cache'
      });
    }

    // 2. Query PostgreSQL Database
    const result = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );

    // If user does not exist in DB
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        userId
      });
    }

    const balance = result.rows[0].balance;

    // 3. Try writing to Redis cache safely
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.setEx(`balance:${userId}`, 60, balance.toString());
      }
    } catch (redisErr) {
      console.warn('Redis Write Error:', redisErr.message);
    }

    return res.status(200).json({
      userId,
      balance: parseFloat(balance),
      source: 'database'
    });

  } catch (error) {
    console.error('Error fetching balance:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error.message
    });
  }
});

module.exports = router;