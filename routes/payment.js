const express = require('express');
const router = express.Router();
const pool = require('../db');
const redisClient = require('../redisClient');
const verifyJwt = require('../middleware/verifyJwt');

const deleteFromCache = async (key) => {
  try {
    if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
      await redisClient.del(key);
    }
  } catch (err) {
    console.warn('Redis Cache Delete Warning:', err.message);
  }
};

// ==========================================
// 1. USER DEPOSIT REQUEST (EasyPaisa / JazzCash)
// ==========================================
router.post('/deposit/request', verifyJwt, async (req, res) => {
  const userId = req.user.userId;
  const { amount, paymentMethod, trxId, senderNumber } = req.body;

  if (!amount || amount <= 0 || !trxId || !paymentMethod) {
    return res.status(400).json({ error: 'amount, paymentMethod, and trxId are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const walletRes = await client.query(
      'SELECT id FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const walletId = walletRes.rows[0].id;

    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1',
      [trxId]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Transaction TRX ID already submitted' });
    }

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status, payment_method, account_number) 
       VALUES ($1, $2, $3, 'DEPOSIT', 'PENDING', $4, $5)`,
      [walletId, trxId, amount, paymentMethod, senderNumber || '']
    );

    await client.query('COMMIT');

    res.json({
      status: 'SUCCESS',
      message: 'Deposit request submitted successfully. Awaiting admin approval.',
      trxId
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Deposit request failed', details: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 2. USER WITHDRAWAL REQUEST
// ==========================================
router.post('/withdraw/request', verifyJwt, async (req, res) => {
  const userId = req.user.userId;
  const { amount, paymentMethod, accountTitle, accountNumber } = req.body;

  if (!amount || amount <= 0 || !paymentMethod || !accountNumber) {
    return res.status(400).json({ error: 'amount, paymentMethod, and accountNumber are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    // Lock requested withdrawal balance immediately
    const newBalance = currentBalance - parseFloat(amount);
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    const withdrawTxId = `WD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status, payment_method, account_number) 
       VALUES ($1, $2, $3, 'WITHDRAWAL', 'PENDING', $4, $5)`,
      [walletId, withdrawTxId, parseFloat(amount), paymentMethod, `${accountTitle || ''} (${accountNumber})`]
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      message: 'Withdrawal request queued successfully',
      newBalance,
      withdrawTxId
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Withdrawal request failed', details: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 3. ADMIN / GATEWAY WEBHOOK (Approve Deposit / Auto-Deposit)
// ==========================================
router.post('/deposit/webhook', async (req, res) => {
  const { userId, amount, paymentTxId, provider } = req.body;

  if (!userId || !amount || !paymentTxId) {
    return res.status(400).json({ error: 'userId, amount, and paymentTxId are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingTx = await client.query(
      'SELECT id FROM transactions WHERE provider_tx_id = $1 AND status = \'SUCCESS\'',
      [paymentTxId]
    );

    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Deposit already processed' });
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
    const newBalance = currentBalance + parseFloat(amount);

    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, walletId]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, provider_tx_id, amount, type, status, payment_method) 
       VALUES ($1, $2, $3, 'DEPOSIT', 'SUCCESS', $4)
       ON CONFLICT (provider_tx_id) DO UPDATE SET status = 'SUCCESS'`,
      [walletId, paymentTxId, parseFloat(amount), provider || 'EASYPAISA']
    );

    await client.query('COMMIT');
    await deleteFromCache(`wallet:balance:${userId}`);

    res.json({
      status: 'SUCCESS',
      message: 'Deposit confirmed & balance credited',
      userId,
      newBalance
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Deposit approval failed', details: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 4. USER TRANSACTION HISTORY
// ==========================================
router.get('/history', verifyJwt, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT t.id, t.provider_tx_id, t.amount, t.type, t.status, t.payment_method, t.created_at
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.user_id = $1
       ORDER BY t.created_at DESC LIMIT 50`,
      [userId]
    );

    res.json({
      status: 'SUCCESS',
      transactions: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve transaction history', details: err.message });
  }
});

module.exports = router;