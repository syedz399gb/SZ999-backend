const crypto = require('crypto');
require('dotenv').config();

const verifySignature = (req, res, next) => {
  const signature = req.headers['x-signature'];
  const secret = process.env.PROVIDER_SECRET || 'default_sz999_provider_secret';

  if (!signature) {
    return res.status(401).json({ error: 'Missing x-signature header' });
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body || {}))
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return res.status(403).json({ error: 'Invalid HMAC signature' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'HMAC verification error', details: err.message });
  }
};

module.exports = verifySignature;