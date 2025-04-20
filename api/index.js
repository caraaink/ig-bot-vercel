const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(express.json());

// Konfigurasi
const config = {
  username: process.env.IG_USERNAME || 'meownimev2', // Gunakan env variable
  password: process.env.IG_PASSWORD || 'eren19',     // Gunakan env variable
  likeBerandaAktif: true,
};

// Inisialisasi Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Inisialisasi Instagram client
const ig = new IgApiClient();

async function initialize() {
  ig.state.generateDevice(config.username);

  // Cek apakah sudah login
  const cookies = await redis.get(`${config.username}-cookies`);
  const userId = await redis.get(`${config.username}-userId`);
  const token = await redis.get(`${config.username}-token`);

  if (cookies && userId && token) {
    ig.state.session = JSON.parse(cookies);
    ig.state.userId = userId;
    ig.state.csrfToken = token;
    return { status: 'ok', userId };
  }

  // Login jika belum
  try {
    await ig.account.login(config.username, config.password);
    const serializedSession = JSON.stringify(ig.state.session);
    await redis.set(`${config.username}-cookies`, serializedSession);
    await redis.set(`${config.username}-userId`, ig.state.userId);
    await redis.set(`${config.username}-token`, ig.state.csrfToken);
    return { status: 'ok', userId: ig.state.userId };
  } catch (error) {
    await redis.append('igerror.log', `${new Date().toISOString()} [LOGIN_ERROR] ${error.message}\n`);
    return { status: 'fail', message: error.message };
  }
}

async function likeTimeline() {
  if (!config.likeBerandaAktif) return { status: 'ok', message: 'Like beranda tidak aktif' };

  const userId = ig.state.userId;
  const logKey = `${userId}_likesTimeline`;

  try {
    const feed = ig.feed.timeline();
    const items = await feed.items();
    const results = [];

    for (const item of items) {
      if (!item.has_liked && !item.is_ad && item.id) {
        const mediaId = item.id;
        // Cek apakah media sudah di-like
        const likedMedia = await redis.smembers(logKey);
        if (!likedMedia.includes(mediaId)) {
          try {
            await ig.media.like({ mediaId });
            await redis.sadd(logKey, mediaId);
            results.push(`[SUCCESS] [LIKE_MEDIA] => ${mediaId}`);
            await redis.append('igerror.log', `${new Date().toISOString()} [LIKE_MEDIA] => ${mediaId} (SUCCESS)\n`);
          } catch (error) {
            results.push(`[ERROR] [LIKE_MEDIA] => ${mediaId} (${error.message})`);
            await redis.append('igerror.log', `${new Date().toISOString()} [LIKE_MEDIA] => ${mediaId} (ERROR: ${error.message})\n`);
          }
        }
      }
    }
    return { status: 'ok', results };
  } catch (error) {
    if (error.message.includes('login_required')) {
      await redis.del(`${config.username}-cookies`, `${config.username}-userId`, `${config.username}-token`);
    }
    await redis.append('igerror.log', `${new Date().toISOString()} [TIMELINE_ERROR] ${error.message}\n`);
    return { status: 'fail', message: error.message };
  }
}

// Endpoint untuk testing
app.get('/', async (req, res) => {
  res.send('Instagram Bot is running. Use /likes to trigger the bot.');
});

// Endpoint untuk cron manual
app.get('/likes', async (req, res) => {
  try {
    const login = await initialize();
    if (login.status === 'fail') {
      return res.status(500).json({ error: login.message });
    }
    const result = await likeTimeline();
    if (result.status === 'fail') {
      return res.status(500).json({ error: result.message });
    }
    res.json({ status: 'success', results: result.results || ['No new media to like'] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
