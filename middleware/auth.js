const crypto = require('crypto');
require('dotenv').config();

const verifySignature = (req, res, next) => {
  const signature = req.headers['x-signature'];
  const secret = process.env.PROVIDER_SECRET;

  if (!signature) {
    return res.status(401).json({ error: 'Missing x-signature header' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(403).json({ error: 'Invalid HMAC signature' });
  }

  next();
};

module.exports = verifySignature;