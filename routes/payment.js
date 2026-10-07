const express = require('express');
const router = express.Router();
const pool = require('../db');
const redisClient = require('../redisClient');

const deleteFromCache = async (key) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      await redisClient.del(key);
    }
  } catch (err) {
    console.warn('Redis Cache Delete Warning:', err.message);
  }
};

// 1. DEPOSIT WEBHOOK (Handles payment gateway deposit confirmation)
router.post('/deposit/webhook', async (req, res) => {
  const { userId, amount, paymentTxId, provider } = req.body;

  if (!userId || !amount || !paymentTxId) {
    return res.status(400).json({ error: 'userId, amount, and paymentTxId are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for duplicate payment transaction
    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1',
      [paymentTxId]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Payment transaction already processed' });
    }

    // Lock and get wallet
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

    const newBalance = currentBalance + parseFloat(amount);

    // Update wallet balance
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    // Record deposit transaction
    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) 
       VALUES ($1, $2, $3, 'DEPOSIT', 'SUCCESS')`,
      [walletId, paymentTxId, amount]
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      message: 'Deposit processed successfully',
      userId,
      newBalance,
      paymentTxId,
      provider: provider || 'UNKNOWN'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Deposit processing failed', details: err.message });
  } finally {
    client.release();
  }
});

// 2. WITHDRAWAL REQUEST ENDPOINT
router.post('/withdraw', async (req, res) => {
  const { userId, amount, withdrawalTxId, accountNumber, provider } = req.body;

  if (!userId || !amount || !withdrawalTxId) {
    return res.status(400).json({ error: 'userId, amount, and withdrawalTxId are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check duplicate
    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1',
      [withdrawalTxId]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Withdrawal transaction ID already exists' });
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

    if (currentBalance < parseFloat(amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
    }

    const newBalance = currentBalance - parseFloat(amount);

    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status) 
       VALUES ($1, $2, $3, 'WITHDRAWAL', 'PENDING')`,
      [walletId, withdrawalTxId, amount]
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      message: 'Withdrawal request queued successfully',
      userId,
      newBalance,
      withdrawalTxId,
      accountNumber: accountNumber || 'N/A',
      provider: provider || 'UNKNOWN'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Withdrawal request failed', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;