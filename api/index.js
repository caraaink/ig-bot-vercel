const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const { kv } = require('@vercel/kv');

const app = express();
app.use(express.json());

// Konfigurasi
const config = {
  username: process.env.IG_USERNAME || 'meownimev2', // Gunakan env variable
  password: process.env.IG_PASSWORD || 'eren19',     // Gunakan env variable
  likeBerandaAktif: true,
};

// Inisialisasi Instagram client
const ig = new IgApiClient();

async function initialize() {
  ig.state.generateDevice(config.username);

  // Cek apakah sudah login
  const cookies = await kv.get(`${config.username}-cookies`);
  const userId = await kv.get(`${config.username}-userId`);
  const token = await kv.get(`${config.username}-token`);

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
    await kv.set(`${config.username}-cookies`, serializedSession);
    await kv.set(`${config.username}-userId`, ig.state.userId);
    await kv.set(`${config.username}-token`, ig.state.csrfToken);
    return { status: 'ok', userId: ig.state.userId };
  } catch (error) {
    await kv.set('igerror.log', `${new Date().toISOString()} [LOGIN_ERROR] ${error.message}\n`, { append: true });
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
        const likedMedia = await kv.smembers(logKey);
        if (!likedMedia.includes(mediaId)) {
          try {
            await ig.media.like({ mediaId });
            await kv.sadd(logKey, mediaId);
            results.push(`[SUCCESS] [LIKE_MEDIA] => ${mediaId}`);
            await kv.set('igerror.log', `${new Date().toISOString()} [LIKE_MEDIA] => ${mediaId} (SUCCESS)\n`, { append: true });
          } catch (error) {
            results.push(`[ERROR] [LIKE_MEDIA] => ${mediaId} (${error.message})`);
            await kv.set('igerror.log', `${new Date().toISOString()} [LIKE_MEDIA] => ${mediaId} (ERROR: ${error.message})\n`, { append: true });
          }
        }
      }
    }
    return { status: 'ok', results };
  } catch (error) {
    if (error.message.includes('login_required')) {
      await kv.del(`${config.username}-cookies`, `${config.username}-userId`, `${config.username}-token`);
    }
    await kv.set('igerror.log', `${new Date().toISOString()} [TIMELINE_ERROR] ${error.message}\n`, { append: true });
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
