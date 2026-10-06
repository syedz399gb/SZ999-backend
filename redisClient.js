const redis = require('redis');
require('dotenv').config();

const client = redis.createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
});

client.on('error', (err) => console.error('Redis Client Error:', err));
client.on('connect', () => console.log('Redis Cache/Lock Engine Connected!'));

(async () => {
  await client.connect();
})();

module.exports = client;