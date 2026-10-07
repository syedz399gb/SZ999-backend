const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const redisClient = require('../redisClient');

// Helper to store session in Redis
const setSessionCache = async (key, value, ttlSeconds = 300) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    }
  } catch (err) {
    console.warn('Redis Session Write Warning:', err.message);
  }
};

// Helper to read session from Redis
const getSessionCache = async (key) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    }
  } catch (err) {
    console.warn('Redis Session Read Warning:', err.message);
  }
  return null;
};

// 1. GENERATE GAME LAUNCH SESSION TOKEN
router.post('/launch', async (req, res) => {
  const { userId, gameId, providerId } = req.body;

  if (!userId || !gameId || !providerId) {
    return res.status(400).json({ error: 'userId, gameId, and providerId are required.' });
  }

  try {
    // Generate a secure random session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionKey = `game:session:${sessionToken}`;

    const sessionData = {
      userId,
      gameId,
      providerId,
      createdAt: new Date().toISOString()
    };

    // Store in Redis with a 5-minute expiry
    await setSessionCache(sessionKey, sessionData, 300);

    res.json({
      status: 'SUCCESS',
      sessionToken,
      userId,
      gameId,
      providerId,
      expiresInSeconds: 300
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate game launch token', details: err.message });
  }
});

// 2. PROVIDER WEBHOOK: AUTHENTICATE SESSION TOKEN
router.post('/authenticate', async (req, res) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ error: 'sessionToken is required.' });
  }

  const sessionKey = `game:session:${sessionToken}`;

  try {
    // Retrieve session from Redis
    const session = await getSessionCache(sessionKey);

    if (!session) {
      return res.status(404).json({ error: 'INVALID_OR_EXPIRED_SESSION' });
    }

    // Query user's wallet balance from DB
    const walletRes = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [session.userId]
    );

    if (walletRes.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found for user' });
    }

    const { balance, currency } = walletRes.rows[0];

    res.json({
      status: 'SUCCESS',
      userId: session.userId,
      balance: parseFloat(balance),
      currency: currency || 'PKR',
      gameId: session.gameId,
      providerId: session.providerId
    });
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

module.exports = router;