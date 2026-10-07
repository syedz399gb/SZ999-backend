const redis = require('redis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;

const client = redis.createClient({
    url: redisUrl
});

client.on('error', (err) => console.warn('Redis Client Warning:', err.message));
client.on('connect', () => console.log('Redis Cache/Lock Engine Connected!'));

(async () => {
    try {
        if (!client.isOpen) {
            await client.connect();
        }
    } catch (err) {
        console.warn('Redis connection failed on startup (falling back to memory/database):', err.message);
    }
})();

module.exports = client;