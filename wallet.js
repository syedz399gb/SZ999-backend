const express = require('express');
const router = express.Router();
const pool = require('./db');
const redisClient = require('./redisClient');
const verifySignature = require('./middleware/auth');

// Safe Redis cache wrapper
const getFromCache = async (key) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      return await redisClient.get(key);
    }
  } catch (err) {
    console.warn('Redis Read Warning:', err.message);
  }
  return null;
};

const setToCache = async (key, value, ttlSeconds = 10) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      await redisClient.setEx(key, ttlSeconds, value.toString());
    }
  } catch (err) {
    console.warn('Redis Write Warning:', err.message);
  }
};

const deleteFromCache = async (key) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      await redisClient.del(key);
    }
  } catch (err) {
    console.warn('Redis Delete Warning:', err.message);
  }
};

// 1. GET BALANCE
router.get('/balance/:userId', async (req, res) => {
  const { userId } = req.params;
  const cacheKey = `wallet:balance:${userId}`;

  try {
    // 1. Try Redis
    const cachedBalance = await getFromCache(cacheKey);
    if (cachedBalance !== null) {
      return res.json({
        status: 'SUCCESS',
        balance: parseFloat(cachedBalance),
        currency: 'PKR',
        cached: true
      });
    }

    // 2. Query Database
    const result = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        error: 'Wallet not found',
        userId
      });
    }

    const balance = parseFloat(result.rows[0].balance);
    const currency = result.rows[0].currency || 'PKR';

    // 3. Save to Redis
    await setToCache(cacheKey, balance, 10);

    return res.json({
      status: 'SUCCESS',
      balance,
      currency,
      cached: false
    });

  } catch (err) {
    console.error('Balance Endpoint Error:', err);
    return res.status(500).json({
      status: 'ERROR',
      error: err.message,
      detail: 'Error querying balance from database'
    });
  }
});

// 2. DEBIT (BET) - Middleware verifySignature vorübergehend für Tests entfernt
router.post('/debit', async (req, res) => {
  const { userId, amount, providerTxId } = req.body;
  const lockKey = `lock:tx:${providerTxId}`;

  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      const acquiredLock = await redisClient.set(lockKey, 'LOCKED', { NX: true, EX: 10 });
      if (!acquiredLock) {
        return res.status(409).json({ error: 'Transaction already in progress or processed' });
      }
    }
  } catch (redisErr) {
    console.warn('Redis Lock Warning:', redisErr.message);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1',
      [providerTxId]
    );
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Duplicate transaction ID' });
    }

    const walletRes = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const currentBalance = parseFloat(walletRes.rows[0].balance);
    const walletId = walletRes.rows[0].id;

    if (currentBalance < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
    }

    const newBalance = currentBalance - amount;
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) 
       VALUES ($1, $2, $3, 'BET', 'SUCCESS')`,
      [walletId, providerTxId, amount]
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      balance: newBalance,
      txId: providerTxId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Transaction failed', details: err.message });
  } finally {
    client.release();
  }
});

// 3. CREDIT (WIN) - Middleware verifySignature vorübergehend für Tests entfernt
router.post('/credit', async (req, res) => {
  const { userId, amount, providerTxId } = req.body;
  const lockKey = `lock:tx:${providerTxId}`;

  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      const acquiredLock = await redisClient.set(lockKey, 'LOCKED', { NX: true, EX: 10 });
      if (!acquiredLock) {
        return res.status(409).json({ error: 'Transaction already in progress or processed' });
      }
    }
  } catch (redisErr) {
    console.warn('Redis Lock Warning:', redisErr.message);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1',
      [providerTxId]
    );
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Duplicate transaction ID' });
    }

    const walletRes = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const currentBalance = parseFloat(walletRes.rows[0].balance);
    const walletId = walletRes.rows[0].id;

    const newBalance = currentBalance + amount;
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) 
       VALUES ($1, $2, $3, 'WIN', 'SUCCESS')`,
      [walletId, providerTxId, amount]
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      balance: newBalance,
      txId: providerTxId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Transaction failed', details: err.message });
  } finally {
    client.release();
  }
});

// 4. ROLLBACK (REFUND) - Middleware verifySignature vorübergehend für Tests entfernt
router.post('/rollback', async (req, res) => {
  const { userId, amount, providerTxId, referenceTxId } = req.body;
  const lockKey = `lock:tx:${providerTxId}`;

  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      const acquiredLock = await redisClient.set(lockKey, 'LOCKED', { NX: true, EX: 10 });
      if (!acquiredLock) {
        return res.status(409).json({ error: 'Transaction already in progress or processed' });
      }
    }
  } catch (redisErr) {
    console.warn('Redis Lock Warning:', redisErr.message);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1',
      [providerTxId]
    );
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Rollback already processed' });
    }

    const originalTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1 AND type = $2',
      [referenceTxId, 'BET']
    );

    if (originalTx.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Original transaction not found' });
    }

    const walletRes = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const currentBalance = parseFloat(walletRes.rows[0].balance);
    const walletId = walletRes.rows[0].id;

    const newBalance = currentBalance + amount;
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) 
       VALUES ($1, $2, $3, 'ROLLBACK', 'SUCCESS')`,
      [walletId, providerTxId, amount]
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      balance: newBalance,
      txId: providerTxId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Rollback failed', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;