const express = require('express');
const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// Validasi environment variables
const requiredEnvVars = ['REDIS_URL', 'IG_USERNAME', 'IG_PASSWORD'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Konfigurasi
const config = {
  username: process.env.IG_USERNAME,
  password: process.env.IG_PASSWORD,
  likeBerandaAktif: true,
};

// Inisialisasi Redis
let redis;
try {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err) => console.error('Redis Client Error:', err));
} catch (error) {
  console.error('Failed to initialize Redis:', error.message);
  process.exit(1);
}

// Inisialisasi Instagram client
const ig = new IgApiClient();

async function handleChallenge() {
  try {
    // Dapatkan URL challenge
    const challengeUrl = ig.state.checkpoint.url;
    await redis.append('igerror.log', `${new Date().toISOString()} [CHALLENGE] Challenge required at ${challengeUrl}\n`);

    // Coba pilih metode verifikasi (misal email atau SMS)
    const { body } = await ig.challenge.selectVerifyMethod(0); // 0 untuk email, 1 untuk SMS (sesuaikan jika perlu)
    if (body.step_name === 'verify_email' || body.step_name === 'verify_sms') {
      await redis.append('igerror.log', `${new Date().toISOString()} [CHALLENGE] Verification code sent to ${body.step_data.contact_point}\n`);
      return { status: 'challenge', message: `Verification code sent to ${body.step_data.contact_point}. Please check and provide the code.` };
    }
    return { status: 'fail', message: 'Unable to handle challenge automatically. Please verify manually.' };
  } catch (error) {
    await redis.append('igerror.log', `${new Date().toISOString()} [CHALLENGE_ERROR] ${error.message}\n`);
    return { status: 'fail', message: error.message };
  }
}

async function initialize() {
  ig.state.generateDevice(config.username);

  // Cek apakah sudah login
  try {
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
      if (error instanceof IgCheckpointError) {
        return await handleChallenge();
      }
      await redis.append('igerror.log', `${new Date().toISOString()} [LOGIN_ERROR] ${error.message}\n`);
      return { status: 'fail', message: error.message };
    }
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
            // Delay untuk hindari rate limit
            await new Promise(resolve => setTimeout(resolve, 1000));
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
    if (login.status === 'challenge') {
      return res.status(403).json({ error: login.message });
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
