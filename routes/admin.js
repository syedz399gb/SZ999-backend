const express = require('express');
const router = express.Router();
const pool = require('../db');

// 1. GET TRANSACTION HISTORY FOR A USER
router.get('/transactions/:userId', async (req, res) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const result = await pool.query(
      `SELECT t.id, t.provider_tx_id, t.amount, t.type, t.status, t.created_at 
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({
      status: 'SUCCESS',
      userId,
      count: result.rows.length,
      transactions: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user transactions', details: err.message });
  }
});

// 2. GET SYSTEM OVERVIEW METRICS
router.get('/overview', async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const totalWallets = await pool.query('SELECT COUNT(*), SUM(balance) AS total_balance FROM wallets');
    const totalTx = await pool.query('SELECT COUNT(*) FROM transactions');

    res.json({
      status: 'SUCCESS',
      metrics: {
        totalRegisteredUsers: parseInt(totalUsers.rows[0].count, 10),
        totalWalletsCreated: parseInt(totalWallets.rows[0].count, 10),
        platformTotalBalance: parseFloat(totalWallets.rows[0].total_balance || 0),
        totalTransactionsProcessed: parseInt(totalTx.rows[0].count, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch platform metrics', details: err.message });
  }
});

module.exports = router;