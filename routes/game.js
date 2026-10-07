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
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionKey = `game:session:${sessionToken}`;

    const sessionData = {
      userId,
      gameId,
      providerId,
      createdAt: new Date().toISOString()
    };

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
    const session = await getSessionCache(sessionKey);

    if (!session) {
      return res.status(404).json({ error: 'INVALID_OR_EXPIRED_SESSION' });
    }

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

// 3. PROVIDER CALLBACK: GAME DEBIT (Bet)
router.post('/debit', async (req, res) => {
  const { userId, transactionId, amount, gameId } = req.body;

  if (!userId || !transactionId || amount === undefined) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency check
    const existingTx = await client.query('SELECT id FROM transactions WHERE provider_tx_id = $1', [transactionId]);
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'DUPLICATE_TRANSACTION' });
    }

    // Get and lock wallet
    const walletRes = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    const currentBalance = parseFloat(walletRes.rows[0].balance);
    const debitAmount = parseFloat(amount);

    if (currentBalance < debitAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
    }

    const newBalance = currentBalance - debitAmount;
    const walletId = walletRes.rows[0].id;

    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, walletId]);
    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) VALUES ($1, $2, $3, 'DEBIT', 'SUCCESS')`,
      [walletId, transactionId, debitAmount]
    );

    await client.query('COMMIT');

    res.json({
      status: 'SUCCESS',
      transactionId,
      userId,
      balance: newBalance,
      currency: 'PKR'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'DEBIT_FAILED', details: err.message });
  } finally {
    client.release();
  }
});

// 4. PROVIDER CALLBACK: GAME CREDIT (Win)
router.post('/credit', async (req, res) => {
  const { userId, transactionId, amount, gameId } = req.body;

  if (!userId || !transactionId || amount === undefined) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingTx = await client.query('SELECT id FROM transactions WHERE provider_tx_id = $1', [transactionId]);
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'DUPLICATE_TRANSACTION' });
    }

    const walletRes = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    const currentBalance = parseFloat(walletRes.rows[0].balance);
    const creditAmount = parseFloat(amount);
    const newBalance = currentBalance + creditAmount;
    const walletId = walletRes.rows[0].id;

    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, walletId]);
    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) VALUES ($1, $2, $3, 'CREDIT', 'SUCCESS')`,
      [walletId, transactionId, creditAmount]
    );

    await client.query('COMMIT');

    res.json({
      status: 'SUCCESS',
      transactionId,
      userId,
      balance: newBalance,
      currency: 'PKR'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'CREDIT_FAILED', details: err.message });
  } finally {
    client.release();
  }
});

// 5. PROVIDER CALLBACK: GAME ROLLBACK (Refund/Cancel Bet)
router.post('/rollback', async (req, res) => {
  const { userId, originalTransactionId, rollbackTransactionId, amount } = req.body;

  if (!userId || !originalTransactionId || !rollbackTransactionId) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency check for rollback transaction
    const existingRollback = await client.query('SELECT id FROM transactions WHERE provider_tx_id = $1', [rollbackTransactionId]);
    if (existingRollback.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'DUPLICATE_ROLLBACK_TRANSACTION' });
    }

    // Verify original transaction exists
    const origTxRes = await client.query(
      'SELECT id, amount, type FROM transactions WHERE provider_tx_id = $1',
      [originalTransactionId]
    );

    if (origTxRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ORIGINAL_TRANSACTION