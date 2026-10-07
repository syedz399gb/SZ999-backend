const rateLimit = require('express-rate-limit');

// General API Rate Limiter (100 requests per minute per IP)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Rate limit exceeded. Please try again later.'
  }
});

// Strict Limiter for Auth Routes (10 attempts per 15 minutes per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_LOGIN_ATTEMPTS',
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  }
});

module.exports = { apiLimiter, authLimiter };