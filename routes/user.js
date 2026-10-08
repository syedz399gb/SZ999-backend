const express = require('express');
const router = express.Router();
const verifyJwt = require('../middleware/verifyJwt');
const pool = require('../db');

// Protect user profile routes with JWT
router.use(verifyJwt);

// GET /api/v1/user/profile -> Fetch logged-in user profile & wallet balance
router.get('/profile', async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT u.user_id, u.username, u.created_at, w.balance, w.currency
       FROM users u
       LEFT JOIN wallets w ON u.user_id = w.user_id
       WHERE u.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({
      status: 'SUCCESS',
      profile: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve profile', details: err.message });
  }
});

module.exports = router;