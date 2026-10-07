const crypto = require('crypto');

const PROVIDER_SECRET = process.env.PROVIDER_SECRET_KEY || 'default_provider_secret_999';

const verifyProviderSig = (req, res, next) => {
  const signature = req.headers['x-provider-signature'];

  if (!signature) {
    return res.status(401).json({ error: 'MISSING_SIGNATURE' });
  }

  // Calculate HMAC SHA256 signature from raw request body
  const expectedSig = crypto
    .createHmac('sha256', PROVIDER_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSig) {
    return res.status(403).json({ error: 'INVALID_SIGNATURE' });
  }

  next();
};

module.exports = verifyProviderSig;