const redis = require('redis');
require('dotenv').config();

const client = redis.createClient({
    url: process.env.REDIS_URL
});

client.on('error', (err) => console.error('Redis Client Error:', err));
client.on('connect', () => console.log('Redis Cache/Lock Engine Connected!'));

(async () => {
    await client.connect();
})();

module.exports = client;